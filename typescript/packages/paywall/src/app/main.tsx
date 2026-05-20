// React entry for the paywall IIFE bundle.
//
// `src/build.ts` esbuild's this file with `format: "iife"` so the runtime
// is fully self-contained — no module loader, no `<script type="module">`.
// The bundle reads `window.x402b` (injected by the server-side
// `generateHtml`) and mounts the React tree into `#root`. If
// `window.x402b` is missing or malformed, the bundle surfaces a clear
// error message instead of silently rendering nothing.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { EvmEscrowPaywall } from "./EvmEscrowPaywall.js";
import { Providers } from "./Providers.js";
import type { InjectedPaywallState } from "../types.js";

declare global {
  interface Window {
    x402b?: InjectedPaywallState;
  }
}

window.addEventListener("load", () => {
  const root = document.getElementById("root");
  if (!root) {
    console.error("x402-paywall: #root element not found in document");
    return;
  }

  const state = window.x402b;
  if (!state || typeof state !== "object" || !state.requirements) {
    const errorEl = document.createElement("p");
    errorEl.className = "x402b-error";
    errorEl.textContent =
      "Paywall failed to load: window.x402b is missing or malformed. The server-side generateHtml() may not have spliced the payload correctly.";
    root.replaceChildren(errorEl);
    return;
  }

  createRoot(root).render(
    <StrictMode>
      <Providers state={state}>
        <EvmEscrowPaywall state={state} />
      </Providers>
    </StrictMode>,
  );
});
