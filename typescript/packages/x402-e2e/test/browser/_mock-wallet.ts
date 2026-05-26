// Installs an EIP-1193 `window.ethereum` shim into a Playwright
// BrowserContext. The shim is backed by a viem private key on the
// Node side — signing requests cross the Playwright IPC bridge via
// `context.exposeFunction`, so the buyer's private key never leaves
// Node. wagmi's injected connector picks the shim up as
// `window.ethereum` and the paywall's `signerFromWalletClient`
// adapter wires through it transparently.

import type { BrowserContext } from "playwright";
import type { Hex, TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Shape of the JSON payload wagmi feeds into `eth_signTypedData_v4`.
 * Mirrors the EIP-712 typed-data document with the
 * `EIP712Domain` entry included in `types` (viem strips it before
 * signing).
 */
interface TypedDataPayload {
  domain: TypedDataDomain;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export type MockWalletMode = "normal" | "reject-sign" | "wrong-chain";

const SIGN_BRIDGE = "__x402_e2e_signTypedData";

export interface InstallMockWalletArgs {
  /**
   * Buyer's private key. Used in-Node by viem to produce the
   * EIP-712 signature returned to the in-browser shim.
   */
  privateKey: Hex;
  /** CAIP-2 chain id without the `eip155:` prefix — e.g. `31337`. */
  chainId: number;
  /**
   * Behaviour mode:
   *   - `"normal"` — sign requests as usual, report the configured `chainId`.
   *   - `"reject-sign"` — `eth_signTypedData_v4` throws an EIP-1193
   *     `code: 4001` user-rejected error.
   *   - `"wrong-chain"` — `eth_chainId` returns mainnet (`0x1`) and
   *     `wallet_switchEthereumChain` rejects with `code: 4001`.
   */
  mode: MockWalletMode;
}

export async function installMockWallet(
  context: BrowserContext,
  args: InstallMockWalletArgs,
): Promise<void> {
  const account = privateKeyToAccount(args.privateKey);

  await context.exposeFunction(SIGN_BRIDGE, async (typedData: TypedDataPayload) => {
    // viem's `signTypedData` adds the `EIP712Domain` entry itself —
    // strip it from the wallet-supplied payload to avoid a duplicate.
    const { EIP712Domain: _ignored, ...types } = typedData.types;
    return account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  });

  await context.addInitScript(
    (initArgs) => {
      const { address, chainIdHex, mode, bridgeName } = initArgs;
      type RpcRequest = { method: string; params?: unknown[] };
      const listeners = new Map<string, ((...payload: unknown[]) => void)[]>();

      const userRejected = (message: string) => {
        const err = new Error(message) as Error & { code: number };
        err.code = 4001;
        return err;
      };

      const request = async (req: RpcRequest): Promise<unknown> => {
        switch (req.method) {
          case "eth_chainId":
            return chainIdHex;
          case "net_version":
            return parseInt(chainIdHex, 16).toString();
          case "eth_accounts":
          case "eth_requestAccounts":
            return [address];
          case "eth_signTypedData_v4": {
            if (mode === "reject-sign") {
              throw userRejected("User rejected typed-data signing.");
            }
            const params = req.params as [string, string];
            const typedData = JSON.parse(params[1]) as unknown;
            const bridge = (
              window as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
            )[bridgeName];
            return await bridge(typedData);
          }
          case "wallet_switchEthereumChain": {
            if (mode === "wrong-chain") {
              throw userRejected("User rejected the network switch.");
            }
            return null;
          }
          case "wallet_addEthereumChain":
            return null;
          default:
            throw new Error(`mock-wallet: unsupported RPC method ${req.method}`);
        }
      };

      const provider = {
        isMetaMask: true,
        request,
        on(event: string, handler: (...payload: unknown[]) => void) {
          const list = listeners.get(event) ?? [];
          list.push(handler);
          listeners.set(event, list);
        },
        removeListener(event: string, handler: (...payload: unknown[]) => void) {
          const list = listeners.get(event);
          if (!list) return;
          listeners.set(
            event,
            list.filter((h) => h !== handler),
          );
        },
        removeAllListeners(event?: string) {
          if (event) listeners.delete(event);
          else listeners.clear();
        },
      };

      (window as unknown as Record<string, unknown>).ethereum = provider;
    },
    {
      address: account.address,
      chainIdHex: `0x${args.chainId.toString(16)}`,
      mode: args.mode,
      bridgeName: SIGN_BRIDGE,
    },
  );
}
