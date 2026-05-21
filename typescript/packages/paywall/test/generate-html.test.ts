// Unit tests for the server-side `generateHtml` + `evmEscrowPaywall`
// surface. The browser React app is exercised end-to-end by the future
// `examples/browser-paywall` demo and an e2e Playwright suite — these
// tests stay narrow on the HTML-splicing contract: the right payload
// ends up in `window.x402b` and the document remains parseable.
//
// We pull the prebuilt template constant in via the package's own
// `generateHtml` so the test exercises the same code path consumers do.
// The template is produced by `pnpm build:app`, so tests run after
// build per the turbo task graph.

import { describe, expect, it } from "vitest";

import { evmEscrowPaywall, generateHtml } from "../src/paywall.js";
import type { EscrowPaymentRequired, PaywallConfig } from "../src/types.js";

const REQUIREMENTS = {
  scheme: "escrow" as const,
  network: "eip155:8453",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  amount: "1000000",
  escrowAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
  recipientId: "did:boson:seller:1",
  maxTimeoutSeconds: 300,
  offer: {
    fullOffer: {},
    sellerSig: "0xdead",
    creator: "0x1111111111111111111111111111111111111111",
  },
  tokenAuthStrategies: ["erc3009" as const],
  actions: { next: [{ id: "boson-createOfferAndCommit", channels: ["server" as const] }] },
};

const payload: EscrowPaymentRequired = {
  requirements: REQUIREMENTS,
  currentUrl: "https://seller.example/protected",
};

const config: PaywallConfig = {
  appName: "Boson Demo",
  testnet: true,
  tokenDomains: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2" },
  },
};

describe("generateHtml", () => {
  it("returns a complete <!DOCTYPE html> document", () => {
    const html = generateHtml(payload);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.includes("</html>")).toBe(true);
  });

  it("splices a <script>window.x402b = { ... }</script> block before </head>", () => {
    const html = generateHtml(payload, config);
    const headIdx = html.indexOf("</head>");
    const injectionIdx = html.indexOf("window.x402b");
    expect(injectionIdx).toBeGreaterThan(-1);
    expect(injectionIdx).toBeLessThan(headIdx);
  });

  it("the injected JSON round-trips through the document, including config", () => {
    const html = generateHtml(payload, config);
    const match = html.match(/window\.x402b = (.*?);<\/script>/);
    expect(match).not.toBeNull();
    const state = JSON.parse(match![1]);
    expect(state.requirements.scheme).toBe("escrow");
    expect(state.requirements.escrowAddress).toBe(REQUIREMENTS.escrowAddress);
    expect(state.currentUrl).toBe("https://seller.example/protected");
    expect(state.config?.appName).toBe("Boson Demo");
    expect(state.config?.testnet).toBe(true);
  });

  it("omits `config` from the injected state when none is supplied", () => {
    const html = generateHtml(payload);
    const match = html.match(/window\.x402b = (.*?);<\/script>/);
    const state = JSON.parse(match![1]);
    expect(state.config).toBeUndefined();
  });

  it("omits `currentUrl` from the injected state when not provided on the payload", () => {
    const html = generateHtml({ requirements: REQUIREMENTS });
    const match = html.match(/window\.x402b = (.*?);<\/script>/);
    const state = JSON.parse(match![1]);
    expect(state.currentUrl).toBeUndefined();
  });

  it("promotes `config.currentUrl` to top-level `state.currentUrl` when the payload omits it", () => {
    const html = generateHtml(
      { requirements: REQUIREMENTS },
      { ...config, currentUrl: "https://seller.example/from-config" },
    );
    const match = html.match(/window\.x402b = (.*?);<\/script>/);
    const state = JSON.parse(match![1]);
    expect(state.currentUrl).toBe("https://seller.example/from-config");
  });

  it("payload.currentUrl wins when both payload and config carry one", () => {
    const html = generateHtml(
      { requirements: REQUIREMENTS, currentUrl: "https://seller.example/from-payload" },
      { ...config, currentUrl: "https://seller.example/from-config" },
    );
    const match = html.match(/window\.x402b = (.*?);<\/script>/);
    const state = JSON.parse(match![1]);
    expect(state.currentUrl).toBe("https://seller.example/from-payload");
  });

  it("escapes a literal </script> inside seller-supplied metadata so the inline tag can't be broken out of", () => {
    // The recipientId carries a malicious </script> payload — without the
    // escape, the inline tag closes early and the rest leaks into the
    // document as HTML.
    const malicious = "</script><img src=x onerror=alert(1)>";
    const tampered: EscrowPaymentRequired = {
      requirements: { ...REQUIREMENTS, recipientId: malicious },
    };
    const html = generateHtml(tampered);
    // The literal `</script>` must not appear inside the injected JSON
    // block. We assert that the only `</script>` in the document is the
    // intended one at the end of the injection.
    const injectionStart = html.indexOf("window.x402b");
    const firstScriptClose = html.indexOf("</script>", injectionStart);
    const afterClose = html.indexOf("</script>", firstScriptClose + 1);
    // There may be additional </script> tags later in the document (e.g.
    // closing the React app block), but inside the injected JSON itself
    // (before the first </script>) there must be none.
    expect(firstScriptClose).toBeGreaterThan(injectionStart);
    // And the escaped form must appear in the JSON payload.
    expect(html.includes("<\\/script")).toBe(true);
    // Sanity: a follow-up </script> still exists (the React app's own).
    expect(afterClose).toBeGreaterThan(firstScriptClose);
  });
});

describe("evmEscrowPaywall", () => {
  it("supports() returns true only for the escrow scheme", () => {
    expect(evmEscrowPaywall.supports({ scheme: "escrow" })).toBe(true);
    expect(evmEscrowPaywall.supports({ scheme: "exact" })).toBe(false);
    expect(evmEscrowPaywall.supports({})).toBe(false);
  });

  it("delegates to generateHtml — same output for the same input", () => {
    const direct = generateHtml(payload, config);
    const viaProvider = evmEscrowPaywall.generateHtml(payload, config);
    expect(viaProvider).toBe(direct);
  });
});
