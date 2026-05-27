// Address + URL constants for the `local-31337-0` Boson environment.
// Lifted from `@bosonprotocol/core-sdk`'s `defaultConfig` so this package
// doesn't drag the SDK in solely to read static values. Source:
// https://github.com/bosonprotocol/core-components/blob/main/packages/common/src/configs.ts
// (the `envConfigs.local[0]` entry).

import type { Address } from "viem";

export const LOCAL_31337_0 = {
  envName: "local",
  configId: "local-31337-0",
  chainId: 31337,
  /** CAIP-2 EVM network id derived from `chainId`. */
  network: "eip155:31337" as const,
  defaultDisputeResolverId: "1",

  urls: {
    /** Hardhat / boson-protocol-node JSON-RPC endpoint (host-side). */
    jsonRpc: "http://localhost:8545",
    /** From-container JSON-RPC endpoint (services running inside compose). */
    jsonRpcInContainer: "http://host.docker.internal:8545",
    /** Boson subgraph GraphQL endpoint (host-side). */
    subgraph: "http://localhost:8000/subgraphs/name/boson/corecomponents",
    /** From-container subgraph endpoint. */
    subgraphInContainer: "http://host.docker.internal:8000/subgraphs/name/boson/corecomponents",
    /** Meta-tx-gateway endpoint (host-side). */
    metaTxGateway: "http://localhost:8888",
    /** From-container meta-tx-gateway endpoint. */
    metaTxGatewayInContainer: "http://host.docker.internal:8888",
    /** Boson MCP server endpoint (host-side). */
    bosonMcp: "http://localhost:3000",
    /** From-container Boson MCP server endpoint. */
    bosonMcpInContainer: "http://host.docker.internal:3000",
  },

  contracts: {
    /** Boson Diamond — the protocol entry point and `escrowAddress` for x402B. */
    protocolDiamond: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853" as Address,
    /** Generic test ERC-20 (`Foreign20`). */
    testErc20: "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49" as Address,
    /** Test token implementing EIP-3009 `receiveWithAuthorization` (`MockERC3009Token`). */
    testErc3009: "0x809d550fca64d94Bd9F66E60752A544199cfAC3D" as Address,
    /** Test token implementing EIP-2612 `permit` (`MockERC2612Token`). */
    testErc2612: "0x4c5859f0F772848b2D91F1D83E2Fe57935348029" as Address,
    /** Permit2 deployment (deterministic address on every chain). */
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
    /** Forwarder the meta-tx-gateway wraps relayed txs through. */
    forwarder: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address,
  },
} as const;
