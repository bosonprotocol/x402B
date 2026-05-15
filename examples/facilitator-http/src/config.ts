import type { FacilitatorConfig } from "@bosonprotocol/x402-facilitator";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface FacilitatorEnv {
  /** Public URL the facilitator service is reachable at; populates `nextActions[].endpoints.facilitator`. */
  url: string;
  /** RPC endpoint the relayer broadcasts through (e.g. `http://host.docker.internal:8545`). */
  rpcNode: string;
  /** Numeric chain id of the network. Default 31337 (Hardhat / Anvil local). */
  chainId: number;
  /** Boson Diamond on the configured chain — the only contract the relayer will sponsor gas for. */
  escrowAddress: Address;
  /** Relayer private key (hex with 0x prefix). Pays gas on settle / perform-action. */
  relayerPk: Hex;
  /** HTTP listen port. */
  port: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`[facilitator-http] missing required env var ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function asAddress(value: string, name: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`[facilitator-http] ${name} must be a 0x-prefixed 20-byte hex address`);
  }
  return value as Address;
}

function asHex32(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`[facilitator-http] ${name} must be a 0x-prefixed 32-byte hex private key`);
  }
  return value as Hex;
}

function asInt(value: string, name: string, { min, max }: { min: number; max?: number }): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    const range = max !== undefined ? `an integer in [${min}, ${max}]` : `an integer >= ${min}`;
    throw new Error(`[facilitator-http] ${name} must be ${range} (got ${JSON.stringify(value)})`);
  }
  return n;
}

export function readEnv(): FacilitatorEnv {
  return {
    url: required("FACILITATOR_URL"),
    rpcNode: required("RPC_NODE"),
    chainId: asInt(optional("CHAIN_ID", "31337"), "CHAIN_ID", { min: 1 }),
    escrowAddress: asAddress(required("ESCROW_ADDRESS"), "ESCROW_ADDRESS"),
    relayerPk: asHex32(required("RELAYER_PK"), "RELAYER_PK"),
    port: asInt(optional("PORT", "8889"), "PORT", { min: 1, max: 65535 }),
  };
}

function chainFor(chainId: number, rpcNode: string): Chain {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcNode] } },
  });
}

export function buildFacilitatorConfig(env: FacilitatorEnv): FacilitatorConfig {
  const chain = chainFor(env.chainId, env.rpcNode);
  const network = `eip155:${env.chainId}` as const;
  const account = privateKeyToAccount(env.relayerPk);

  const walletClient: WalletClient = createWalletClient({
    account,
    chain,
    transport: http(env.rpcNode),
  });
  const publicClient: PublicClient = createPublicClient({
    chain,
    transport: http(env.rpcNode),
  });

  return {
    url: env.url,
    supportedNetworks: [network],
    escrows: { [network]: env.escrowAddress },
    walletClient,
    publicClient,
  };
}
