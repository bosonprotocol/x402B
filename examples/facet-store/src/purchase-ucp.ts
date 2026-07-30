/**
 * purchase-ucp.ts — full buyer-side purchase: discover + price with the KYA flow
 * (search → quote → payments/quote → handle402), then COMMIT and REDEEM over the UCP
 * checkout-session endpoints, authenticating as a *buyer agent* with your OWN key
 * (RFC 9421 request signatures, ES256) instead of the seller-only dispatch path.
 *
 * WHY THIS EXISTS
 *   purchase.ts is the minimal, readable version of this same flow (see
 *   AGENT-PURCHASE-FLOW.md); this one is the instrumented sibling — it prints every request and
 *   response, exposes the product, ship-to and network as env vars, and waits for the relayed
 *   commit to confirm on-chain before redeeming. Reach for it when something needs debugging.
 *
 *   Note on the path NOT taken: `POST /v1/payments/dispatch` is the SELLER-relayed path,
 *   permanently gated to a site-admin merchant session — a buyer agent always gets 401 there.
 *   The buyer-facing commit path is the UCP checkout-session flow, and its auth is an RFC 9421
 *   request signature you produce with your own published key. The seller only *verifies*;
 *   it issues you nothing.
 *
 * IDENTITY (the confusing bit, made concrete)
 *   You generate an ES256 / P-256 keypair and publish ONLY the public half in a tiny "UCP
 *   profile" JSON at any public HTTPS URL you control (a GitHub Gist raw URL is enough — it
 *   does NOT go on the seller's site, and no /.well-known route is required). Every request
 *   carries `UCP-Agent: profile="<that url>"`; the Terminal fetches it, finds your key by
 *   `keyid` in `signing_keys[]`, and verifies the signature. Your key never leaves this process.
 *
 * FLOW
 *   1. search          → cheapest product           (FacetClient.search, KYA)   [PRODUCT_ID optional]
 *   2. quote           → quote_token + landed total  (FacetClient.quote, KYA)
 *   3. payments/quote  → seller-signed EscrowPaymentRequirements (raw, KYA; escrowAddress lives here)
 *   4. handle402       → base64 X-PAYMENT            (buyer signs the commit locally; nothing broadcasts)
 *   5. CREATE          → POST /ucp/v1/checkout-sessions            (signed) → checkout id
 *   6. COMPLETE        → POST /ucp/v1/checkout-sessions/{id}/complete (signed) → ON-CHAIN COMMIT
 *   7. confirm         → poll the session until the relayed tx confirms and exchange_id appears
 *   8. REDEEM          → POST /ucp/v1/checkout-sessions/redeem     (signed) {exchange_id, signed_payload}
 *
 * NETWORK
 *   Defaults to the SANDBOX terminal, whose UCP boson_escrow handler settles on Base Sepolia
 *   (eip155:84532) — TEST USDC, no real funds. Flip TERMINAL + NETWORK to go to production
 *   (my-boson-shop-2.facet.llc / base / eip155:8453, REAL USDC).
 *
 * ── Setup ─────────────────────────────────────────────────────────────────────
 *   1. cp .env.example .env, set BUYER_PRIVATE_KEY in it, then:  pnpm buy:ucp --init
 *        (.env is git-ignored — keeps the key out of your shell history and the process list.)
 *        Generates your ES256 signing key and writes:
 *          .facet-agent-key.json   PRIVATE (your signing key). git-ignored. Never share it.
 *          ucp-profile.json        PUBLIC  (your public key only). Publish this.
 *        Prints your buyer wallet address (derived from BUYER_PRIVATE_KEY) to fund.
 *   2. Publish ucp-profile.json to a GitHub Gist; copy the *revision-pinned* raw URL
 *      (gist.githubusercontent.com/<user>/<id>/raw/<sha>/ucp-profile.json — no redirect).
 *   3. Fund the printed address with USDC on the target network (Base Sepolia test USDC by
 *      default). No ETH needed — the commit is gasless (the facilitator pays gas).
 *
 * ── Run (config via env or a git-ignored .env file — see .env.example) ──────────
 *   # dry run: discovers + prices, signs the commit locally, creates the (signed)
 *   # checkout session to prove your signature verifies, then STOPS. Nothing moves.
 *   pnpm buy:ucp
 *
 *   # real commit + redeem (moves USDC into escrow, waits for confirmation, then redeems):
 *   SETTLE=1 pnpm buy:ucp
 *
 * Every hop prints the request line and the full response so you can audit it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as wc } from "node:crypto";
import { FacetClient } from "@facet-llc/client";
import { createX402bClient, parseChainId, type Signer } from "@bosonprotocol/x402-client";
import { parseEscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import { fetchTokenDomain } from "@bosonprotocol/x402-core/eip712/token-auth";
import { createPublicClient, erc20Abi, http, type Address, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ── .env loader (dependency-free; real env always wins over the file) ───────────
function loadDotEnv(): void {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf-8");
    for (const line of text.split(/\r?\n/)) {
      let t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("export ")) t = t.slice(7).trim();
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env file — fine */
  }
}
loadDotEnv();

// ── What to buy / where ───────────────────────────────────────────────────────
const TERMINAL = (process.env.TERMINAL ?? "https://my-boson-shop-2.sandbox.facet.llc").replace(
  /\/+$/,
  "",
);
const SITE_ID = process.env.SITE_ID ?? "3623dfa8-3d62-45ba-8dee-1e63dd9a1cb0";
const RAIL_ID = process.env.RAIL_ID ?? "coin/boson-escrow";
const AID = process.env.AID ?? "agent:my-tester";
const USDC_DECIMALS = 6;
const PRODUCT_ID = process.env.PRODUCT_ID ?? ""; // optional — empty ⇒ auto-select cheapest
const QTY = Number(process.env.QTY ?? "1");

// ── Network (Base Sepolia sandbox by default | Base mainnet for production) ─────
type NetKey = "base" | "base-sepolia";
const NETWORK = (process.env.NETWORK ?? "base-sepolia") as NetKey;
const NETWORKS: Record<NetKey, { chain: Chain; chainId: number; rpc: string; usdc: Address }> = {
  base: {
    chain: base,
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  },
  "base-sepolia": {
    chain: baseSepolia,
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  },
};
const cfg = NETWORKS[NETWORK];
if (!cfg) {
  console.error(`Unknown NETWORK "${NETWORK}". Use "base" or "base-sepolia".`);
  process.exit(1);
}
const RPC = process.env.RPC ?? cfg.rpc;
const USDC = (process.env.USDC_ADDRESS ?? cfg.usdc) as Address;

const MAX_ATOMIC = Math.round(Number(process.env.MAX_USDC ?? "20") * 1e6);
const SETTLE = process.env.SETTLE === "1";
const PROFILE_URL = process.env.UCP_PROFILE_URL ?? "";
const KEY_FILE = new URL("../.facet-agent-key.json", import.meta.url); // git-ignored (.facet-*.json)
const PROFILE_FILE = new URL("../ucp-profile.json", import.meta.url); // public — publish this

// Commit → redeem confirmation: how long to wait for the relayed tx to confirm and
// expose the exchange id before redeeming.
const CONFIRM_ATTEMPTS = Number(process.env.COMMIT_CONFIRM_ATTEMPTS ?? "12");
const CONFIRM_DELAY_MS = Number(process.env.COMMIT_CONFIRM_DELAY_MS ?? "5000");

// Where the goods ship — priced + sealed into the checkout. All six required.
const SHIP_TO = {
  recipient: process.env.SHIP_RECIPIENT ?? "Test Buyer",
  line1: process.env.SHIP_LINE1 ?? "1 Market Street",
  locality: process.env.SHIP_CITY ?? "San Francisco",
  region: process.env.SHIP_REGION ?? "CA", // 2-letter; the KYA quote uses "US-CA"
  postal_code: process.env.SHIP_POSTAL ?? "94105",
  country: process.env.SHIP_COUNTRY ?? "US",
};

const cyan = (s: string) => `\x1b[1;36m${s}\x1b[0m`;
const title = (step: string, t: string) => console.log("\n" + cyan(`┌─ ${step} · ${t}`));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════
//  RFC 9421 request signing (ES256), inlined. Covered components, in order:
//    @method @authority @path [@query] ucp-agent [idempotency-key]
//    [content-digest content-type]. Signature is raw r||s (P-256), which
//  WebCrypto's ECDSA already emits.
// ════════════════════════════════════════════════════════════════════════════
const ENC = new TextEncoder();
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// NOTE: RFC 9421 `created` and the Boson client's ERC-3009 `validBefore` both come from the
// host clock. Keep the machine's time synced — a skewed clock yields "signature_stale" on
// CREATE and "validBefore has already expired" on COMPLETE.
async function contentDigest(body: string): Promise<string> {
  const hash = await wc.subtle.digest("SHA-256", ENC.encode(body));
  return `sha-256=:${b64(new Uint8Array(hash))}:`;
}

async function signRequest(opts: {
  method: string;
  url: string;
  kid: string;
  privateKey: CryptoKey;
  profileUrl: string;
  body?: string;
  idempotencyKey?: string;
}): Promise<Record<string, string>> {
  const u = new URL(opts.url);
  const components: string[] = ["@method", "@authority", "@path"];
  const values: Record<string, string> = {
    "@method": opts.method.toUpperCase(),
    "@authority": u.host.toLowerCase(),
    "@path": u.pathname,
  };
  if (u.search.length > 0) {
    components.push("@query");
    values["@query"] = u.search;
  }
  components.push("ucp-agent");
  values["ucp-agent"] = `profile="${opts.profileUrl}"`;
  if (opts.idempotencyKey !== undefined) {
    components.push("idempotency-key");
    values["idempotency-key"] = opts.idempotencyKey;
  }
  let digest: string | undefined;
  if (opts.body !== undefined) {
    components.push("content-digest", "content-type");
    digest = await contentDigest(opts.body);
    values["content-digest"] = digest;
    values["content-type"] = "application/json";
  }
  const created = Math.floor(Date.now() / 1000);
  const spv =
    `(${components.map((c) => `"${c}"`).join(" ")})` + `;created=${created};keyid="${opts.kid}"`;
  const baseStr =
    components.map((c) => `"${c}": ${values[c]}`).join("\n") + `\n"@signature-params": ${spv}`;
  const sig = new Uint8Array(
    await wc.subtle.sign(SIGN_PARAMS, opts.privateKey, ENC.encode(baseStr)),
  );
  const out: Record<string, string> = {
    "Signature-Input": `sig1=${spv}`,
    Signature: `sig1=:${b64(sig)}:`,
    "UCP-Agent": `profile="${opts.profileUrl}"`,
    "content-type": "application/json",
  };
  if (digest !== undefined) out["Content-Digest"] = digest;
  if (opts.idempotencyKey !== undefined) out["Idempotency-Key"] = opts.idempotencyKey;
  return out;
}

// ── Buyer wallet (reuse BUYER_PRIVATE_KEY — the same EOA as purchase.ts) ────────
const rawKey = process.env.BUYER_PRIVATE_KEY;
if (!rawKey) {
  console.error(
    "BUYER_PRIVATE_KEY is required (hex, with or without 0x prefix). Put it in .env or the environment.",
  );
  process.exit(1);
}
const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as `0x${string}`);

// ════════════════════════════════════════════════════════════════════════════
//  --init : generate your ES256 signing key + emit the profile to publish.
//  (The commit wallet is BUYER_PRIVATE_KEY — this step does NOT create one.)
// ════════════════════════════════════════════════════════════════════════════
if (process.argv.includes("--init")) {
  const kid = `agent-${wc.randomUUID().slice(0, 8)}`;
  const pair = (await wc.subtle.generateKey(ECDSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateJwk = await wc.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await wc.subtle.exportKey("jwk", pair.publicKey);

  // 0o600 — owner-only. Applies when the file is created; it does not relax an existing mode.
  writeFileSync(KEY_FILE, JSON.stringify({ kid, privateJwk, publicJwk }, null, 2), {
    mode: 0o600,
  });
  const profile = {
    ucp_version: "1.0",
    name: "Agent buyer",
    signing_keys: [
      {
        kid,
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
        use: "sig",
        alg: "ES256",
      },
    ],
  };
  writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + "\n");

  console.log(
    `\nWrote ${KEY_FILE.pathname}  (PRIVATE — your ES256 signing key; git-ignored, never share)`,
  );
  console.log(`Wrote ${PROFILE_FILE.pathname}  (PUBLIC — publish this)`);
  console.log(`\nYour buyer wallet (funds the commit): ${account.address}\n`);
  console.log(`Next:`);
  console.log(`  1. Publish ucp-profile.json to a GitHub Gist; use the revision-pinned raw URL.`);
  console.log(
    `  2. Put UCP_PROFILE_URL in .env, and fund ${account.address} with USDC on ${NETWORK}.`,
  );
  console.log(`  3. pnpm buy:ucp        (dry run — spends nothing)`);
  process.exit(0);
}

if (PROFILE_URL === "") {
  console.error(
    "Set UCP_PROFILE_URL to your published ucp-profile.json URL (in .env or the environment).\nFirst time? Run:  pnpm buy:ucp --init",
  );
  process.exit(1);
}

// ── Load your signing key ───────────────────────────────────────────────────────
let keyFile: { kid: string; privateJwk: JsonWebKey };
try {
  keyFile = JSON.parse(readFileSync(KEY_FILE, "utf-8"));
} catch {
  console.error("No .facet-agent-key.json — run:  pnpm buy:ucp --init");
  process.exit(1);
}
const privateKey = await wc.subtle.importKey("jwk", keyFile.privateJwk, ECDSA, false, ["sign"]);
const publicClient = createPublicClient({ chain: cfg.chain, transport: http(RPC) });

// ── KYA token: mint a FRESH single-use token per request (never cache) ──────────
const mintKya = async (): Promise<string> => {
  const resp = await fetch(`${TERMINAL}/v1/test_helpers/mint_kya`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aid: AID }),
  });
  if (!resp.ok) throw new Error(`mint_kya failed ${resp.status}: ${await resp.text()}`);
  const body = (await resp.json()) as Record<string, unknown>;
  const token = (body.kya_token ?? body.token ?? body.jwt ?? body.access_token) as
    | string
    | undefined;
  if (!token) throw new Error(`No token in mint_kya response: ${JSON.stringify(body)}`);
  return token;
};

// ── Raw KYA-authenticated POST for boson-escrow endpoints the client doesn't wrap ──
type TerminalError = Error & { status?: number; code?: string };
type TerminalErrorBody = { error?: { code?: string; message?: string } };
const terminalPost = async <T>(path: string, payload: unknown): Promise<T> => {
  const token = await mintKya();
  const resp = await fetch(`${TERMINAL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "@facet-llc/client/0.3.0",
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!resp.ok) {
    const { error } = body as TerminalErrorBody;
    const code = error?.code;
    const err: TerminalError = new Error(
      `POST ${path} → ${resp.status} ${code ?? ""}: ${error?.message ?? text}`,
    );
    err.status = resp.status;
    err.code = code;
    throw err;
  }
  return body as T;
};

// @facet-llc/client — pass the token provider (NOT a cached string) so it re-mints a
// fresh single-use token on every authenticated request.
const client = new FacetClient({ terminalUrl: TERMINAL, kyaToken: mintKya });

const x402b = createX402bClient({
  signer: {
    getAddress: async () => account.address,
    signTypedData: (a) => account.signTypedData(a as Parameters<typeof account.signTypedData>[0]),
  } satisfies Signer,
  subgraphUrls: { [cfg.chainId]: process.env.BOSON_SUBGRAPH_URL ?? "https://subgraph.invalid/x" },
  // Read the token's real EIP-712 domain on-chain (works on any chain, no
  // hardcoded "USD Coin" — a wrong name silently yields a rejected signature).
  tokenDomainResolver: (asset, chainId) => fetchTokenDomain(publicClient, asset, chainId),
  policy: { tokenAuthStrategy: "erc3009", redeemMode: "commit-only" },
});

type Json = Record<string, unknown>;

/** Every place a terminal has been observed to surface the committed exchange id. */
type ExchangeIdCarrier = {
  escrow_state?: { exchange_id?: unknown; exchangeId?: unknown; exchange_state?: unknown };
  status?: unknown;
  exchange_id?: unknown;
  exchangeId?: unknown;
  order?: { exchange_id?: unknown; exchangeId?: unknown };
  exchange?: { id?: unknown; exchange_id?: unknown };
  checkout?: { exchange_id?: unknown; exchangeId?: unknown };
  payment?: { exchange_id?: unknown; rail_metadata?: { exchange_id?: unknown } };
  rail_metadata?: { exchange_id?: unknown };
  next_actions?: { exchangeId?: unknown };
  nextActions?: { exchangeId?: unknown };
};

/** The CREATE response slice this script reads. `config` stays loose — the seller-signed
 *  offer inside it is handed back verbatim and only read via parseEscrowPaymentRequirements. */
type CheckoutSession = { id?: unknown; payment_handlers?: Record<string, { config?: Json }[]> };

/** Print the request, run it, print the full response. Returns status + parsed body + raw Response. */
async function raw(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  printBody?: string,
) {
  console.log(`${method} ${url}`);
  if (body !== undefined) console.log(`  body: ${printBody ?? body}`);
  const res = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(text + "\n");
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON already printed */
  }
  return { status: res.status, json, res };
}

const usdcBalance = () =>
  publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

/** Best-effort lift of the committed exchange id from a checkout / payment response. */
function extractExchangeId(json: Json, res: Response): string | undefined {
  const j = json as ExchangeIdCarrier;
  const candidates = [
    j?.escrow_state?.exchange_id,
    j?.escrow_state?.exchangeId, // Facet COMPLETE 200 shape
    j?.exchange_id,
    j?.exchangeId,
    j?.order?.exchange_id,
    j?.order?.exchangeId,
    j?.exchange?.id,
    j?.exchange?.exchange_id,
    j?.checkout?.exchange_id,
    j?.checkout?.exchangeId,
    j?.payment?.exchange_id,
    j?.payment?.rail_metadata?.exchange_id,
    j?.rail_metadata?.exchange_id,
    j?.next_actions?.exchangeId,
    j?.nextActions?.exchangeId,
  ];
  for (const c of candidates) if (c != null && String(c) !== "") return String(c);
  try {
    const summary = x402b.parsePaymentResponse(res);
    if (summary?.exchangeId) return summary.exchangeId;
  } catch {
    /* header absent / malformed — fall through */
  }
  return undefined;
}

/** Resolve the committed exchange_id. The COMPLETE response is authoritative (Facet relays the
 *  commit synchronously and returns escrow_state.exchange_id + exchange_state); a signed session
 *  GET is only a best-effort fallback for terminals that defer the id. */
async function resolveExchangeId(
  checkoutId: string,
  complete: { json: Json; res: Response },
): Promise<string | undefined> {
  title("7", "CONFIRM · commit result");
  const j = complete.json as ExchangeIdCarrier;
  const state = j?.escrow_state?.exchange_state ?? j?.status;
  let id = extractExchangeId(complete.json, complete.res);
  if (id) {
    console.log(`commit confirmed · exchange_id ${id}${state ? ` · state ${state}` : ""}`);
    return id;
  }
  console.log(`no exchange_id in the commit response — polling the session as a fallback…`);
  const getUrl = `${TERMINAL}/ucp/v1/checkout-sessions/${checkoutId}`;
  for (let i = 1; i <= CONFIRM_ATTEMPTS; i++) {
    await sleep(CONFIRM_DELAY_MS);
    console.log(`  confirm ${i}/${CONFIRM_ATTEMPTS} …`);
    const headers = await signRequest({
      method: "GET",
      url: getUrl,
      kid: keyFile.kid,
      privateKey,
      profileUrl: PROFILE_URL,
    });
    const s = await raw("GET", getUrl, headers);
    id = extractExchangeId(s.json, s.res) ?? id;
    if (id) return id;
  }
  return id;
}

// ── REDEEM · sign a boson-redeem meta-tx and STORE it with the Terminal ─────────
// Per the terminal's OpenAPI, this endpoint "Stores only; it moves no funds" — the
// held redeem is submitted on-chain later by the merchant fulfillment webhook
// (deferred-redeem policy). So a 2xx here means "stored", not "redeemed on-chain".
async function doRedeem(exchangeId: string, network: string, escrowAddress: Address) {
  title("8", "REDEEM · POST /ucp/v1/checkout-sessions/redeem · store signed boson-redeem");
  const signed = await x402b.signAction({
    actionId: "boson-redeem",
    exchangeId,
    network, // CAIP-2, e.g. "eip155:84532"
    escrowAddress, // Boson Diamond from the CREATE session offer
  });
  const redeemUrl = `${TERMINAL}/ucp/v1/checkout-sessions/redeem`;
  const redeemBody = JSON.stringify({
    exchange_id: exchangeId,
    signed_payload: signed.signedPayload,
  });
  const idem = wc.randomUUID();
  const headers = await signRequest({
    method: "POST",
    url: redeemUrl,
    kid: keyFile.kid,
    privateKey,
    profileUrl: PROFILE_URL,
    body: redeemBody,
    idempotencyKey: idem,
  });
  const redeem = await raw("POST", redeemUrl, headers, redeemBody);
  if (redeem.status < 200 || redeem.status >= 300) {
    throw new Error(
      `REDEEM store failed (${redeem.status}). The commit stands; the signed redeem for exchange ${exchangeId} can be stored later.`,
    );
  }
  console.log(
    `✓ Redeem stored for exchange ${exchangeId}. Facet's merchant fulfillment webhook submits it on-chain when the order is marked fulfilled (deferred-redeem).`,
  );
}

async function main() {
  console.log(`Network:  ${NETWORK} (eip155:${cfg.chainId})`);
  console.log(`Terminal: ${TERMINAL}`);
  console.log(`Buyer:    ${account.address}  (keyid ${keyFile.kid})\n`);

  // ── 1 · SEARCH → cheapest product (unless PRODUCT_ID is pinned) ───────────────
  title("1", "SEARCH · cheapest catalog product (KYA)");
  let productId = PRODUCT_ID;
  if (productId === "") {
    const { results } = await client.search({ query: "", limit: 100 });
    if (!results.length) throw new Error("Catalog is empty.");
    const product = results.reduce((cheapest, item) =>
      item.pricing.per_case < cheapest.pricing.per_case ? item : cheapest,
    );
    productId = product.id;
    console.log(
      `cheapest: ${product.name} (id=${productId}) — ${product.pricing.per_case} ${product.pricing.currency}`,
    );
  } else {
    console.log(`using pinned PRODUCT_ID=${productId}`);
  }

  // ── 2 · QUOTE → quote_token + landed total (KYA; physical goods need a ship-to) ─
  title("2", "QUOTE · landed total + single-use quote_token (KYA)");
  const quote = await client.quote({
    product_id: productId,
    qty: QTY,
    fulfillment: {
      mode: "inline",
      address: {
        recipient: SHIP_TO.recipient,
        line1: SHIP_TO.line1,
        locality: SHIP_TO.locality,
        region: `${SHIP_TO.country}-${SHIP_TO.region}`,
        postal_code: SHIP_TO.postal_code,
        country: SHIP_TO.country,
      },
    },
  });
  const total = quote.total_landed ?? quote.subtotal;
  const amountUsdc = Math.round(total * 10 ** USDC_DECIMALS);
  console.log(`quote_token: ${quote.quote_token ? "present" : "MISSING"}`);
  console.log(
    `total:       ${total} ${quote.currency}  →  ${amountUsdc} atomic USDC  (expires ${quote.expires_at})`,
  );

  // ── 3 · PAYMENTS/QUOTE → seller-signed requirements (KYA) · price cross-check ───
  title("3", "PAYMENTS/QUOTE · seller-signed requirements (KYA) · price cross-check");
  const pq = await terminalPost<{ requirements: unknown }>("/v1/payments/quote", {
    site_id: SITE_ID,
    rail_id: RAIL_ID,
    product_id: productId,
    amount: { amount: amountUsdc, currency: "USDC" },
    quote_token: quote.quote_token,
  });
  const pqOffer = parseEscrowPaymentRequirements(pq.requirements);
  console.log(`amount:  ${pqOffer.amount} atomic on ${pqOffer.network}`);
  console.log(`escrow:  ${pqOffer.escrowAddress}`);

  // ── 4 · CREATE (signed) → checkout id + the session's own seller-signed offer ───
  // We commit against CREATE's offer (tied to THIS session's reservation): COMPLETE
  // re-verifies the credential against the reservation and its schema expects "the
  // seller-signed offer echoed from CREATE". The payments/quote offer above is a
  // cross-check only.
  title("4", "CREATE · POST /ucp/v1/checkout-sessions (signed) · session offer is authoritative");
  const createUrl = `${TERMINAL}/ucp/v1/checkout-sessions`;
  const [first, ...rest] = SHIP_TO.recipient.split(" ");
  const createBody = JSON.stringify({
    line_items: [{ item: { id: productId }, quantity: QTY }],
    fulfillment: {
      methods: [
        {
          id: "ship",
          type: "shipping",
          destinations: [
            {
              id: "d1",
              first_name: first,
              last_name: rest.join(" ") || "Buyer",
              street_address: SHIP_TO.line1,
              address_locality: SHIP_TO.locality,
              address_region: SHIP_TO.region,
              postal_code: SHIP_TO.postal_code,
              address_country: SHIP_TO.country,
            },
          ],
        },
      ],
    },
  });
  const createHeaders = await signRequest({
    method: "POST",
    url: createUrl,
    kid: keyFile.kid,
    privateKey,
    profileUrl: PROFILE_URL,
    body: createBody,
  });
  const create = await raw("POST", createUrl, createHeaders, createBody);
  if (create.status !== 201 && create.status !== 200) {
    // 401 codes: signature_missing | signature_invalid | signature_stale | key_not_found | digest_mismatch.
    // signature_stale → the host clock is skewed vs the server; sync it. key_not_found → the Terminal
    // fetched your profile but couldn't match the keyid: check UCP_PROFILE_URL resolves (no redirect)
    // and try the enveloped { ucp: { signing_keys } } profile shape.
    throw new Error(`CREATE failed (${create.status}). Nothing moved.`);
  }
  const session = create.json as CheckoutSession;
  const checkoutId = String(session.id ?? "");
  if (!checkoutId) throw new Error("CREATE returned no checkout id. Nothing moved.");

  const bcfg = session.payment_handlers?.["llc.facet.boson_escrow"]?.[0]?.config;
  if (!bcfg?.["offer"])
    throw new Error("CREATE did not advertise an llc.facet.boson_escrow offer. Nothing moved.");
  const requirements = bcfg["offer"]; // raw — handed to handle402 + the commit body
  const offer = parseEscrowPaymentRequirements(requirements); // parsed — for field reads
  console.log(`checkout   ${checkoutId}`);
  console.log(`escrow     ${offer.escrowAddress}`);
  console.log(`amount     ${offer.amount} atomic on ${offer.network}`);

  // Guardrails on the offer we actually commit.
  if (parseChainId(offer.network) !== cfg.chainId)
    throw new Error(`Offer is ${offer.network}, not eip155:${cfg.chainId}. Refusing.`);
  if (offer.asset.toLowerCase() !== USDC.toLowerCase())
    throw new Error(`Offer asset ${offer.asset} != USDC ${USDC}. Refusing.`);
  if (!offer.tokenAuthStrategies.includes("erc3009"))
    throw new Error(`Offer lacks erc3009 (${offer.tokenAuthStrategies.join(", ")}). Refusing.`);
  if (!(Number(offer.amount) > 0)) throw new Error("Offer carried no price. Refusing.");
  if (Number(offer.amount) > MAX_ATOMIC)
    throw new Error(
      `Offer ${Number(offer.amount) / 1e6} USDC over ${MAX_ATOMIC / 1e6} cap. Refusing.`,
    );
  // Cross-check against the payments/quote offer (informational).
  if (pqOffer.escrowAddress.toLowerCase() !== offer.escrowAddress.toLowerCase())
    console.warn(
      `⚠ payments/quote escrow ${pqOffer.escrowAddress} != CREATE escrow ${offer.escrowAddress}`,
    );
  if (BigInt(pqOffer.amount) !== BigInt(offer.amount))
    console.warn(`⚠ payments/quote amount ${pqOffer.amount} != CREATE amount ${offer.amount}`);

  // ── 5 · HANDLE402 → buyer signs the commit locally (nothing broadcasts) ────────
  title("5", "AUTHORIZE · handle402 signs the commit locally (no network call)");
  const xPayment = await x402b.handle402(requirements);
  const balance = await usdcBalance();
  console.log(`buyer USDC ${Number(balance) / 1e6}`);
  console.log(`authorizes ${Number(offer.amount) / 1e6} USDC on eip155:${cfg.chainId}`);
  console.log(`X-PAYMENT  ${xPayment.length}b · withheld (unconsumed spend authorization)`);

  if (!SETTLE) {
    console.log(
      `\nDRY RUN complete. Signature verified (CREATE ${create.status}), item priced, offer fetched, commit signed. NOTHING MOVED.`,
    );
    console.log(
      `Real order (moves ${Number(offer.amount) / 1e6} USDC into escrow, waits for confirmation, then redeems):`,
    );
    console.log(`  SETTLE=1 pnpm buy:ucp`);
    return;
  }

  // ── 6 · COMPLETE (signed) · the real on-chain commit ──────────────────────────
  if (balance < BigInt(offer.amount)) {
    throw new Error(
      `Balance ${Number(balance) / 1e6} < ${Number(offer.amount) / 1e6} USDC required. Fund ${account.address} on ${NETWORK}. Nothing moved.`,
    );
  }
  title("6", "COMPLETE · POST /ucp/v1/checkout-sessions/{id}/complete · ON-CHAIN COMMIT");
  const completeUrl = `${TERMINAL}/ucp/v1/checkout-sessions/${checkoutId}/complete`;
  const completeBody = JSON.stringify({
    payment: {
      instruments: [
        { credential: { type: "boson_commit_authorization", x_payment: xPayment, requirements } },
      ],
    },
  });
  const printBody = JSON.stringify({
    payment: {
      instruments: [
        {
          credential: {
            type: "boson_commit_authorization",
            x_payment: `[withheld ${xPayment.length}b]`,
            requirements,
          },
        },
      ],
    },
  });
  const completeHeaders = await signRequest({
    method: "POST",
    url: completeUrl,
    kid: keyFile.kid,
    privateKey,
    profileUrl: PROFILE_URL,
    body: completeBody,
    idempotencyKey: wc.randomUUID(),
  });
  const complete = await raw("POST", completeUrl, completeHeaders, completeBody, printBody);
  if (complete.status < 200 || complete.status >= 300) {
    throw new Error(`COMPLETE failed (${complete.status}). Check the response above.`);
  }

  // ── 7 · CONFIRM → exchange_id (derived from the commit; polled until on-chain) ──
  const exchangeId = await resolveExchangeId(checkoutId, complete);
  if (!exchangeId) {
    console.warn(
      `\n⚠ Commit accepted but no exchange_id surfaced within ${(CONFIRM_ATTEMPTS * CONFIRM_DELAY_MS) / 1000}s.`,
    );
    console.warn(
      `  The commit stands; re-run with a larger COMMIT_CONFIRM_ATTEMPTS/COMMIT_CONFIRM_DELAY_MS, or find the id on the subgraph.`,
    );
    return;
  }
  console.log(`\nCommitted. exchange_id = ${exchangeId}`);

  // ── 8 · REDEEM ──────────────────────────────────────────────────────────────
  await doRedeem(exchangeId, offer.network, offer.escrowAddress as Address);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
