// wagmi + react-query provider tree.
//
// Builds a single-chain wagmi `Config` from the chain referenced by the
// 402 PaymentRequirements. Connectors offered (in render order):
//
//  1. `injected()`           — MetaMask / Rabby / Brave / Frame
//  2. `coinbaseWallet()`     — Coinbase Wallet (works without external config)
//  3. `walletConnect()`      — only if `config.walletConnectProjectId` is set
//
// One `QueryClient` per page load is fine — the paywall is a one-shot
// experience that ends in a document replacement.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

import { parseChainIdFromCaip2, resolveChain } from "./chain.js";
import type { InjectedPaywallState } from "../types.js";

interface Props {
  state: InjectedPaywallState;
  children: ReactNode;
}

export function Providers({ state, children }: Props) {
  const { config: wagmiConfig, queryClient } = useMemo(() => {
    const chainId = parseChainIdFromCaip2(state.requirements.network);
    const chain = resolveChain(chainId);
    const appName = state.config?.appName ?? "x402B paywall";
    const wcProjectId = state.config?.walletConnectProjectId;
    const connectors = [
      injected({ shimDisconnect: true }),
      coinbaseWallet({ appName }),
      ...(wcProjectId
        ? [
            walletConnect({
              projectId: wcProjectId,
              metadata: { name: appName, description: appName, url: "", icons: [] },
              showQrModal: true,
            }),
          ]
        : []),
    ];
    const config = createConfig({
      chains: [chain],
      connectors,
      transports: { [chain.id]: http() },
    });
    return { config, queryClient: new QueryClient() };
  }, [state]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
