/**
 * purchase.ts — a minimal, self-contained example: a buyer AGENT buys an item from a
 * Facet store over UCP, paying into Boson Protocol escrow with the x402B scheme.
 *
 * See AGENT-PURCHASE-FLOW.md for the full walkthrough. In short, the agent:
 *   1. browses the store catalog and picks an item (here: the cheapest),
 *   2. creates a checkout session and signs a spend authorization locally,
 *   3. commits the payment into escrow on-chain (gasless for the buyer),
 *   4. stores a signed "redeem" the store submits once the order is fulfilled.
 *
 * Two credentials are involved (see AGENT-PURCHASE-FLOW.md → Requirements):
 *   • a KYA bearer token — to read the catalog (store-issued; the sandbox mints a test one),
 *   • your own ES256 key + a published UCP profile — to sign the checkout requests.
 *
 * Setup (once):
 *   cp .env.example .env  → then set BUYER_PRIVATE_KEY in it. Keep the key in .env (git-ignored)
 *                           rather than on the command line, where it would land in your shell
 *                           history and the process list.
 *   pnpm buy --init
 *     → writes .facet-agent-key.json (PRIVATE) and ucp-profile.json (PUBLIC)
 *     → publish ucp-profile.json at any public HTTPS URL (a GitHub Gist raw URL works)
 *     → put that URL in .env as UCP_PROFILE_URL
 *     → fund the printed wallet address with USDC on the store's network
 * Run:
 *   pnpm buy
 *     → dry run: prices + signs everything locally, moves nothing
 *   SETTLE=1 pnpm buy
 *     → real: commits USDC into escrow, then stores the redeem
 * (.env lives in the package root, next to package.json; real env vars override it.)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as wc } from "node:crypto";
import { FacetClient } from "@facet-llc/client";
import { createX402bClient } from "@bosonprotocol/x402-client";
import { parseEscrowPaymentRequirements } from "@bosonprotocol/x402-core/schemes/escrow";
import { fetchTokenDomain } from "@bosonprotocol/x402-core/eip712/token-auth";
import { createPublicClient, erc20Abi, http, type Address, type Chain } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Optional: load a local .env (real environment variables take precedence).
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env file — fine */
}

// ── Config — defaults target the my-boson-shop-2 SANDBOX on Base Sepolia (test USDC). ──
// For production, point TERMINAL at the live store and switch the chain + USDC address below.
const TERMINAL = (process.env.TERMINAL ?? "https://my-boson-shop-2.sandbox.facet.llc").replace(
  /\/+$/,
  "",
);
const CHAIN: Chain = baseSepolia; // eip155:84532
const RPC = process.env.RPC ?? "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address; // Base Sepolia USDC
const NETWORK = `eip155:${CHAIN.id}`; // CAIP-2 form of CHAIN — the offer must match it
const TOKEN_AUTH = "erc3009" as const; // the spend-authorization strategy this script signs
const AID = process.env.AID ?? "agent:my-tester"; // agent id for the sandbox KYA mint
const MAX_USDC = Number(process.env.MAX_USDC ?? "20"); // spend cap (safety)
const SETTLE = process.env.SETTLE === "1"; // unset = dry run (moves nothing)
const PROFILE_URL = process.env.UCP_PROFILE_URL ?? "";

const KEY_FILE = new URL("../.facet-agent-key.json", import.meta.url); // PRIVATE (git-ignored)
const PROFILE_FILE = new URL("../ucp-profile.json", import.meta.url); // PUBLIC (publish this)

// Where the goods ship — priced into the checkout. Use a real, serviceable address.
const SHIP_TO = {
  first: "Test",
  last: "Buyer",
  line1: "1 Market Street",
  city: "San Francisco",
  region: "CA",
  postal: "94105",
  country: "US",
};

// ────────────────────────────────────────────────────────────────────────────────────
// RFC 9421 request signing (ES256) — the auth for the checkout endpoints. Signs the method,
// host, path, the UCP-Agent header (your profile URL) and the body digest; the store fetches
// your profile, finds your public key by `keyid`, and verifies the signature.
// ────────────────────────────────────────────────────────────────────────────────────
const ENC = new TextEncoder();
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function signedHeaders(
  url: string,
  kid: string,
  key: CryptoKey,
  body: string,
): Promise<Record<string, string>> {
  const u = new URL(url);
  const idem = wc.randomUUID();
  const digest = `sha-256=:${b64(new Uint8Array(await wc.subtle.digest("SHA-256", ENC.encode(body))))}:`;
  const covered = [
    "@method",
    "@authority",
    "@path",
    "ucp-agent",
    "idempotency-key",
    "content-digest",
    "content-type",
  ];
  const values: Record<string, string> = {
    "@method": "POST",
    "@authority": u.host.toLowerCase(),
    "@path": u.pathname,
    "ucp-agent": `profile="${PROFILE_URL}"`,
    "idempotency-key": idem,
    "content-digest": digest,
    "content-type": "application/json",
  };
  const params = `(${covered.map((c) => `"${c}"`).join(" ")});created=${Math.floor(Date.now() / 1000)};keyid="${kid}"`;
  const base =
    covered.map((c) => `"${c}": ${values[c]}`).join("\n") + `\n"@signature-params": ${params}`;
  const sig = new Uint8Array(
    await wc.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, ENC.encode(base)),
  );
  return {
    "content-type": "application/json",
    "UCP-Agent": `profile="${PROFILE_URL}"`,
    "Idempotency-Key": idem,
    "Content-Digest": digest,
    "Signature-Input": `sig1=${params}`,
    Signature: `sig1=:${b64(sig)}:`,
  };
}

// ── Wallet (also signs the ERC-3009 spend authorization) ──
const rawKey = process.env.BUYER_PRIVATE_KEY;
if (!rawKey) {
  console.error("Set BUYER_PRIVATE_KEY (hex, with or without 0x).");
  process.exit(1);
}
const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as `0x${string}`);

// ── `--init`: create your signing key + the UCP profile to publish, then exit. ──
if (process.argv.includes("--init")) {
  const kid = `agent-${wc.randomUUID().slice(0, 8)}`;
  const pair = (await wc.subtle.generateKey(ECDSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const priv = await wc.subtle.exportKey("jwk", pair.privateKey);
  const pub = await wc.subtle.exportKey("jwk", pair.publicKey);
  writeFileSync(KEY_FILE, JSON.stringify({ kid, privateJwk: priv }, null, 2));
  writeFileSync(
    PROFILE_FILE,
    JSON.stringify(
      {
        ucp_version: "1.0",
        name: "Agent buyer",
        signing_keys: [
          { kid, kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, use: "sig", alg: "ES256" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Wrote .facet-agent-key.json (PRIVATE — never share) and ucp-profile.json (PUBLIC).");
  console.log("Next:");
  console.log("  1. Publish ucp-profile.json at a public HTTPS URL (a GitHub Gist raw URL works).");
  console.log(`  2. Fund this wallet with USDC on the store's network: ${account.address}`);
  console.log('  3. UCP_PROFILE_URL="https://…/ucp-profile.json" pnpm buy   (dry run)');
  process.exit(0);
}
if (!PROFILE_URL) {
  console.error("Set UCP_PROFILE_URL (run with --init first to generate the profile).");
  process.exit(1);
}

const { kid, privateJwk } = JSON.parse(readFileSync(KEY_FILE, "utf-8")) as {
  kid: string;
  privateJwk: JsonWebKey;
};
const signKey = await wc.subtle.importKey("jwk", privateJwk, ECDSA, false, ["sign"]);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });

// KYA bearer token for catalog reads. The sandbox exposes a test-helper mint; a live store
// issues KYA through its own issuer (see AGENT-PURCHASE-FLOW.md → Requirements).
const mintKya = async (): Promise<string> => {
  const r = await fetch(`${TERMINAL}/v1/test_helpers/mint_kya`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aid: AID }),
  });
  const b = (await r.json()) as Record<string, string>;
  return b.kya_token ?? b.token ?? b.jwt ?? b.access_token;
};

// x402B client: signs the ERC-3009 spend authorization + the Boson commit/redeem meta-txs.
const x402b = createX402bClient({
  signer: {
    getAddress: async () => account.address,
    signTypedData: (a) => account.signTypedData(a as Parameters<typeof account.signTypedData>[0]),
  },
  subgraphUrls: { [CHAIN.id]: "https://subgraph.invalid/x" }, // not queried in this flow
  tokenDomainResolver: (asset, chainId) => fetchTokenDomain(publicClient, asset, chainId),
  policy: { tokenAuthStrategy: TOKEN_AUTH, redeemMode: "commit-only" },
});

// The slices of the Facet checkout responses this example reads. `offer` stays `unknown`:
// it is the seller-signed payload, handed back verbatim to handle402 and to the commit body,
// and only ever *read* through parseEscrowPaymentRequirements below.
type CheckoutSession = {
  id: string;
  payment_handlers?: Record<string, { config?: { offer?: unknown } }[]>;
};
type CompletedCheckout = {
  order?: { id?: string };
  escrow_state?: { exchange_id?: string; exchange_state?: string };
};

// POST a signed JSON request to a checkout endpoint; return the parsed body (throws on non-2xx).
async function post<T>(path: string, payload: unknown): Promise<T> {
  const url = `${TERMINAL}${path}`;
  const body = JSON.stringify(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: await signedHeaders(url, kid, signKey, body),
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function main() {
  console.log(`Store  ${TERMINAL}`);
  console.log(`Buyer  ${account.address}  (keyid ${kid})\n`);

  // 1 · Browse the catalog (KYA) and pick the cheapest item.
  const client = new FacetClient({ terminalUrl: TERMINAL, kyaToken: mintKya });
  const { results } = await client.search({ query: "", limit: 100 });
  if (!results.length) throw new Error("Catalog is empty.");
  const item = results.reduce((cheapest, i) =>
    i.pricing.per_case < cheapest.pricing.per_case ? i : cheapest,
  );
  console.log(
    `1 · picked "${item.name}" (id=${item.id}) — ${item.pricing.per_case} ${item.pricing.currency}`,
  );

  // 2 · Create a checkout session (signed). The store prices it and returns a seller-signed
  //     Boson escrow offer (network, USDC amount, escrow address).
  const checkout = await post<CheckoutSession>("/ucp/v1/checkout-sessions", {
    line_items: [{ item: { id: item.id }, quantity: 1 }],
    fulfillment: {
      methods: [
        {
          id: "ship",
          type: "shipping",
          destinations: [
            {
              id: "d1",
              first_name: SHIP_TO.first,
              last_name: SHIP_TO.last,
              street_address: SHIP_TO.line1,
              address_locality: SHIP_TO.city,
              address_region: SHIP_TO.region,
              postal_code: SHIP_TO.postal,
              address_country: SHIP_TO.country,
            },
          ],
        },
      ],
    },
  });
  const requirements = checkout.payment_handlers?.["llc.facet.boson_escrow"]?.[0]?.config?.offer;
  if (!requirements) throw new Error("Store did not offer Boson escrow for this item.");
  const offer = parseEscrowPaymentRequirements(requirements); // validates the seller-signed offer

  // The chain, USDC address and token-auth strategy above are hardcoded, so refuse any offer that
  // disagrees with them. Without this the script would happily sign a spend authorization for a
  // different network or asset (say real USDC on Base mainnet) while reading the balance of — and
  // reporting — the hardcoded one.
  if (offer.network !== NETWORK)
    throw new Error(`Offer network is ${offer.network}, expected ${NETWORK} (${CHAIN.name}).`);
  if (offer.asset.toLowerCase() !== USDC.toLowerCase())
    throw new Error(`Offer asset is ${offer.asset}, expected ${USDC}.`);
  if (!offer.tokenAuthStrategies.includes(TOKEN_AUTH))
    throw new Error(
      `Offer accepts token-auth [${offer.tokenAuthStrategies.join(", ")}], not ${TOKEN_AUTH}.`,
    );

  const amount = Number(offer.amount) / 1e6;
  console.log(`2 · checkout ${checkout.id} — ${amount} USDC into escrow ${offer.escrowAddress}`);
  if (amount > MAX_USDC) throw new Error(`Price ${amount} USDC exceeds MAX_USDC (${MAX_USDC}).`);

  // 3 · Sign the spend authorization locally (ERC-3009). Nothing is broadcast yet.
  const xPayment = await x402b.handle402(requirements);
  const balance =
    Number(
      await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ) / 1e6;
  console.log(`3 · authorized ${amount} USDC · wallet balance ${balance} USDC`);

  if (!SETTLE) {
    console.log("\nDry run — nothing moved. Re-run with SETTLE=1 to buy for real.");
    return;
  }
  if (balance < amount)
    throw new Error(`Insufficient USDC: need ${amount}, have ${balance}. Fund ${account.address}.`);

  // 4 · Commit (signed). The store relays the payment into escrow on-chain — gasless for the
  //     buyer — and returns the committed Boson exchange id.
  const done = await post<CompletedCheckout>(`/ucp/v1/checkout-sessions/${checkout.id}/complete`, {
    payment: {
      instruments: [
        { credential: { type: "boson_commit_authorization", x_payment: xPayment, requirements } },
      ],
    },
  });
  const exchangeId = done.escrow_state?.exchange_id;
  console.log(
    `4 · committed · order ${done.order?.id} · exchange ${exchangeId} (${done.escrow_state?.exchange_state})`,
  );
  if (!exchangeId) throw new Error("Commit succeeded but no exchange id was returned.");

  // 5 · Redeem (signed). Sign the Boson redeem and hand it to the store, which submits it
  //     on-chain once the order is fulfilled (deferred — releases the escrow to the seller).
  const redeem = await x402b.signAction({
    actionId: "boson-redeem",
    exchangeId,
    network: offer.network,
    escrowAddress: offer.escrowAddress as Address,
  });
  await post<unknown>("/ucp/v1/checkout-sessions/redeem", {
    exchange_id: exchangeId,
    signed_payload: redeem.signedPayload,
  });
  console.log(`5 · redeem stored for exchange ${exchangeId}. Purchase complete.`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
