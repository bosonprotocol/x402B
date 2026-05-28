// Main paywall UI for the Boson `escrow` scheme.
//
// Stages (driven off the `status` state):
//
//   idle    → render offer summary + connectors
//   signing → wallet picker disabled, "preparing payment" + spinner
//   submitting → "submitting payment, waiting for resource" + spinner
//   success → resource loaded; we swap document.documentElement with the
//             parsed response root and unmount React
//   error   → render the error message + a Retry button
//
// All wallet flows funnel through `signerFromWalletClient` (from
// `@bosonprotocol/x402-client-browser`) wrapping the viem `WalletClient`
// produced by wagmi. The signer then drives `createX402bClient.handle402`
// which packs the X-PAYMENT header — two EIP-712 signatures (meta-tx +
// token authorization) happen inside that single call.
//
// Each Pay click mints a fresh `X-X402-Boson-Session-Id` and stamps it on
// both the challenge re-fetch (which yields the offer we sign) and the
// X-PAYMENT retry, mirroring `@bosonprotocol/x402-client-fetch`. This
// scopes the resource server's signed-offer cache to the flow so distinct
// browser buyers don't collide on its fallback cache slot — see the inline
// note in `handlePay`.

import { SESSION_ID_HEADER } from "@bosonprotocol/x402-core";
import { fetchTokenDomain } from "@bosonprotocol/x402-core/eip712/token-auth";
import { findEscrowAccept } from "@bosonprotocol/x402-core/schemes/escrow";
import { createX402bClient, signerFromWalletClient } from "@bosonprotocol/x402-client-browser";
import { useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import { parseChainIdFromCaip2 } from "./chain.js";
import type { InjectedPaywallState, PaywallConfig } from "../types.js";

type Status = "idle" | "signing" | "submitting" | "success" | "error";

const X_PAYMENT_HEADER = "X-PAYMENT";

interface Props {
  state: InjectedPaywallState;
}

export function EvmEscrowPaywall({ state }: Props) {
  const { requirements, config } = state;
  // `generateHtml` promotes `config.currentUrl` into `state.currentUrl`, so a
  // single read here covers both server-side input paths.
  const currentUrl =
    state.currentUrl ?? (typeof window !== "undefined" ? window.location.href : "");
  const requiredChainId = useMemo(
    () => parseChainIdFromCaip2(requirements.network),
    [requirements.network],
  );

  // `useAccount().chainId` is the chain the connected wallet actually
  // reports — NOT `useChainId()`, which returns the wagmi config's chain
  // (the single chain from PaymentRequirements). On a wrong-network
  // wallet those differ: `useChainId()` would still read the configured
  // chain and mask the mismatch, so the wrong-network warning never
  // fires. Reading the connection's own chain id is what lets us detect
  // it. Undefined until a wallet connects (then `wrongNetwork` is gated
  // by `isConnected` anyway).
  const { isConnected, chainId: connectedChainId } = useAccount();
  // `switchChainAsync` (not `switchChain`): the non-async `switchChain`
  // is fire-and-forget and never throws, so `await`-ing it wouldn't catch
  // a wallet that rejects the switch — execution would fall through with
  // the chain still wrong. The async form rejects, so the catch below can
  // surface the refusal.
  const { switchChainAsync } = useSwitchChain();
  const { connect, isPending: connectPending } = useConnect();
  const enabledConnectors = useConnectors();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  // PublicClient for the required chain (the wagmi Providers tree is
  // configured with that chain). Used to read the token's EIP-712 domain
  // on-chain so the buyer signs against the same `{ name, version }` the
  // facilitator will recover against — see fetchTokenDomain.
  const publicClient = usePublicClient({ chainId: requiredChainId });

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [selectedFulfillment, setSelectedFulfillment] = useState<string | undefined>(() => {
    return requirements.fulfillment?.options[0]?.id;
  });
  // Rapid clicks can fire `handlePay` again before React re-renders the
  // disabled button, which would launch a second signing/submission
  // flow in parallel. Guard with a ref so the second click is a no-op.
  const payInFlightRef = useRef(false);

  const wrongNetwork = isConnected && connectedChainId !== requiredChainId;

  async function handlePay() {
    if (payInFlightRef.current) return;
    payInFlightRef.current = true;
    try {
      // Resolve a wrong network FIRST. On a chain the wagmi config
      // doesn't know about, `useWalletClient()` stays undefined, so the
      // `!walletClient` guard below would otherwise short-circuit with a
      // misleading "not ready" message and never prompt the switch.
      if (wrongNetwork) {
        try {
          await switchChainAsync({ chainId: requiredChainId });
        } catch (err) {
          setStatus("error");
          setErrorMessage(`Wallet refused to switch to chain ${requiredChainId}: ${describe(err)}`);
          return;
        }
      }
      if (!walletClient) {
        setStatus("error");
        setErrorMessage("Wallet client is not ready yet — try clicking Pay again.");
        return;
      }
      if (requirements.fulfillment?.required && !selectedFulfillment) {
        setStatus("error");
        setErrorMessage("Pick a delivery option before continuing.");
        return;
      }

      setStatus("signing");
      setErrorMessage(undefined);
      try {
        if (!publicClient) {
          setStatus("error");
          setErrorMessage(
            `No public RPC client is available for chain ${requiredChainId}; cannot resolve the token's EIP-712 domain.`,
          );
          return;
        }
        const signer = signerFromWalletClient(walletClient);
        const tokenDomainOverride = lookupTokenDomain(config?.tokenDomains, requirements.asset);
        const client = createX402bClient({
          signer,
          // Resolve the token's EIP-712 domain on-chain (EIP-5267 →
          // name() + version()) so the buyer signs against the same
          // `{ name, version }` the facilitator will recover against.
          // `paywallConfig.tokenDomains` remains an explicit override for
          // tokens whose deployed `name()` differs from the EIP-712 name
          // they actually sign against.
          tokenDomainResolver: async (asset, chainId) => {
            if (tokenDomainOverride) {
              return {
                name: tokenDomainOverride.name,
                version: tokenDomainOverride.version,
                chainId,
                verifyingContract: asset,
              };
            }
            return fetchTokenDomain(publicClient, asset as Address, chainId);
          },
          ...(requirements.fulfillment?.required && selectedFulfillment
            ? { fulfillment: { option: selectedFulfillment, data: null } }
            : {}),
        });

        // Mint one session id for this buyer flow and stamp it on BOTH
        // the challenge re-fetch below and the X-PAYMENT retry, mirroring
        // `@bosonprotocol/x402-client-fetch`'s `wrapFetchWithPayment`. The
        // resource server scopes its signed-offer cache to this id, so the
        // offer we sign here and the offer it re-resolves at settle are the
        // same one — while distinct buyer flows get distinct offers, so a
        // single-quantity offer template isn't served to two sequential
        // commits within the server's cache TTL.
        //
        // We re-resolve requirements from the server under this id rather
        // than signing the navigation-time `requirements` injected into the
        // page: that injection was built under the server's fallback cache
        // slot (a top-level browser navigation can't carry the header), so
        // signing it would make the retry's session-scoped re-resolve
        // mismatch the payload's offer (the validator deep-equals
        // `offerRef.fullOffer` / `sellerSig`). The injected `requirements`
        // still drive the offer summary above — every buyer-visible field
        // is env-derived and identical across sessions.
        const sessionId = globalThis.crypto.randomUUID();
        const challenge = await fetch(currentUrl, {
          headers: { Accept: "application/json", [SESSION_ID_HEADER]: sessionId },
        });
        if (challenge.status !== 402) {
          setStatus("error");
          setErrorMessage(`Expected a 402 challenge, got status ${challenge.status}.`);
          return;
        }
        const escrowEntry = findEscrowAccept(await challenge.json().catch(() => undefined));
        if (!escrowEntry) {
          setStatus("error");
          setErrorMessage(
            `Server did not return an escrow payment requirement (status ${challenge.status}).`,
          );
          return;
        }
        const headerValue = await client.handle402(escrowEntry);

        setStatus("submitting");
        const response = await fetch(currentUrl, {
          headers: { [X_PAYMENT_HEADER]: headerValue, [SESSION_ID_HEADER]: sessionId },
        });
        if (response.status === 402) {
          const body = await response.text();
          throw new Error(`Server still returned 402 after payment; body: ${body.slice(0, 200)}`);
        }
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Resource request failed (${response.status}): ${body.slice(0, 200)}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          const html = await response.text();
          replaceDocument(html);
          setStatus("success");
          return;
        }
        // For non-HTML resources we must not re-navigate to `currentUrl` —
        // the server middleware sees no X-PAYMENT on that second hop and
        // would loop the buyer right back to the paywall. Instead, stream
        // the response we already paid for into a Blob and hand the
        // browser an object URL it can render natively (images, JSON,
        // PDFs) or download (application/octet-stream, etc.).
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        // Revoke the object URL once this document unloads as the browser
        // navigates to it — by `pagehide` the navigation has already
        // resolved the URL, so the resource still renders while we avoid
        // pinning the (potentially large) blob in memory for the tab's life.
        window.addEventListener("pagehide", () => URL.revokeObjectURL(objectUrl), {
          once: true,
        });
        window.location.replace(objectUrl);
        setStatus("success");
      } catch (err) {
        setStatus("error");
        setErrorMessage(describe(err));
      }
    } finally {
      payInFlightRef.current = false;
    }
  }

  return (
    <div className="x402b-paywall" data-testid="paywall-root" data-paywall-status={status}>
      <header className="x402b-header">
        {config?.appLogo ? <img className="x402b-logo" src={config.appLogo} alt="" /> : null}
        <h1>{config?.appName ?? "Payment required"}</h1>
        {config?.testnet ? <span className="x402b-badge">testnet</span> : null}
      </header>

      <section className="x402b-offer">
        <OfferSummary state={state} />
      </section>

      {requirements.fulfillment && requirements.fulfillment.options.length > 1 ? (
        <section className="x402b-fulfillment">
          <label htmlFor="x402b-fulfillment-select">Delivery option</label>
          <select
            id="x402b-fulfillment-select"
            value={selectedFulfillment ?? ""}
            onChange={(e) => setSelectedFulfillment(e.target.value)}
            disabled={status !== "idle"}
          >
            {requirements.fulfillment.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.id}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      <section className="x402b-wallet">
        {!isConnected ? (
          <ConnectorList
            connectors={enabledConnectors}
            disabled={connectPending || status !== "idle"}
            onConnect={(id) => {
              const connector = enabledConnectors.find((c) => c.id === id);
              if (connector) connect({ connector });
            }}
          />
        ) : (
          <WalletStatus
            wrongNetwork={wrongNetwork}
            requiredChainId={requiredChainId}
            connectedChainId={connectedChainId}
            onDisconnect={() => disconnect()}
          />
        )}
      </section>

      <section className="x402b-actions">
        <button
          type="button"
          className="x402b-pay"
          data-testid="paywall-pay"
          disabled={!isConnected || status === "signing" || status === "submitting"}
          onClick={handlePay}
        >
          {status === "signing"
            ? "Sign payment in your wallet…"
            : status === "submitting"
              ? "Settling — please wait…"
              : status === "success"
                ? "Loaded"
                : "Pay & redeem"}
        </button>
        {errorMessage ? (
          <p className="x402b-error" data-testid="paywall-error">
            {errorMessage}
          </p>
        ) : null}
      </section>

      <PaywallFooter config={config} />
    </div>
  );
}

function OfferSummary({ state }: { state: InjectedPaywallState }) {
  const { requirements } = state;
  return (
    <dl className="x402b-offer-dl">
      <dt>Amount</dt>
      <dd>
        <code>{requirements.amount}</code> (atomic units of{" "}
        <code>{shortAddress(requirements.asset)}</code>)
      </dd>
      <dt>Network</dt>
      <dd>
        <code>{requirements.network}</code>
      </dd>
      <dt>Escrow</dt>
      <dd>
        <code>{shortAddress(requirements.escrowAddress)}</code>
      </dd>
      <dt>Seller</dt>
      <dd>
        <code>{requirements.recipientId}</code>
      </dd>
      <dt>Timeout</dt>
      <dd>{requirements.maxTimeoutSeconds}s</dd>
    </dl>
  );
}

function ConnectorList(props: {
  connectors: readonly { id: string; name: string }[];
  disabled: boolean;
  onConnect: (id: string) => void;
}) {
  if (props.connectors.length === 0) {
    return <p className="x402b-no-connector">No wallet connectors configured.</p>;
  }
  return (
    <ul className="x402b-connectors">
      {props.connectors.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="x402b-connector"
            data-testid={`paywall-connector-${c.id}`}
            disabled={props.disabled}
            onClick={() => props.onConnect(c.id)}
          >
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function WalletStatus(props: {
  wrongNetwork: boolean;
  requiredChainId: number;
  // `useAccount().chainId` is undefined until the connection resolves;
  // this component only renders once connected, so it's defined in
  // practice, but the type stays honest.
  connectedChainId: number | undefined;
  onDisconnect: () => void;
}) {
  return (
    <div className="x402b-wallet-status">
      {props.wrongNetwork ? (
        <p className="x402b-warning" data-testid="paywall-wrong-network">
          Connected to chain {props.connectedChainId}; the payment requires {props.requiredChainId}.
          The Pay button will request a network switch.
        </p>
      ) : (
        <p className="x402b-ok" data-testid="paywall-wallet-connected">
          Wallet connected.
        </p>
      )}
      <button type="button" className="x402b-disconnect" onClick={props.onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}

function PaywallFooter({ config }: { config?: PaywallConfig }) {
  return (
    <footer className="x402b-footer">
      <small>
        Powered by{" "}
        <a href="https://github.com/bosonprotocol/x402B" target="_blank" rel="noreferrer">
          @bosonprotocol/x402-paywall
        </a>
        {config?.testnet ? " — testnet" : null}
      </small>
    </footer>
  );
}

function shortAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// EVM addresses are case-insensitive on chain (EIP-55 only encodes a
// checksum), so the `tokenDomains` map should match whether the consumer
// supplied lowercased, uppercased, or checksummed keys. Walk the entries
// once and compare on `toLowerCase()` rather than forcing callers to
// pre-normalize.
function lookupTokenDomain(
  map: Record<string, { name: string; version: string }> | undefined,
  asset: string,
): { name: string; version: string } | undefined {
  if (!map) return undefined;
  const needle = asset.toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === needle) return value;
  }
  return undefined;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Swap the current document with the HTML body of the paid resource.
// `document.open() / write() / close()` rather than a DOMParser splice:
// DOMParser-cloned `<script>` nodes are flagged "already started" and
// will never execute, leaving any paid HTML that depends on inline or
// external JS broken. The open/write/close path lets the HTML parser
// take the string fresh, which handles doctype, head, body, and script
// execution exactly as a top-level navigation would. The resource came
// from a server we just paid, so trusting its HTML is the same trust
// boundary the buyer already crossed.
function replaceDocument(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
