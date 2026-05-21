// Map a CAIP-2 EVM network string (`eip155:<chainId>`) to a viem `Chain`
// definition. Only a small set of well-known chains are included — the
// rest fall back to a synthetic placeholder so wagmi can at least attempt
// the connection. A real production paywall would want the host
// application to inject the relevant `Chain` objects through
// PaywallConfig, but that's beyond the MVP scope.

import {
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
  type Chain,
} from "viem/chains";

const KNOWN_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [optimism.id]: optimism,
  [optimismSepolia.id]: optimismSepolia,
  [polygon.id]: polygon,
  [polygonAmoy.id]: polygonAmoy,
};

const CAIP2_PATTERN = /^eip155:(\d+)$/;

export function parseChainIdFromCaip2(network: string): number {
  const match = network.match(CAIP2_PATTERN);
  if (!match) {
    throw new Error(
      `x402-paywall: unsupported network format ${JSON.stringify(network)}; expected "eip155:<chainId>"`,
    );
  }
  return Number(match[1]);
}

export function resolveChain(chainId: number): Chain {
  const known = KNOWN_CHAINS[chainId];
  if (known) return known;
  // Synthetic fallback so wagmi can wire up for unsupported chains.
  // This placeholder uses a non-functional RPC URL, so callers still need
  // to provide a real `Chain` definition / RPC configuration for actual use.
  return {
    id: chainId,
    name: `EVM chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.example.invalid"] } },
  } satisfies Chain;
}
