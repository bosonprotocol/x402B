// `ipfs-pointer` fulfillment channel.
//
// Buyer optionally attaches `{ recipientPubKey? }` at commit. The
// server stores the record against the exchange id and, at redeem
// time, hands it to the configured `upload` hook which is responsible
// for assembling the resource bytes, optionally encrypting them to
// `recipientPubKey`, and returning the resulting IPFS CID. The
// channel returns `ipfs://<cid>` as the async pointer.
//
// `upload` is the injection point — this package does not own the
// IPFS client, the resource source, or any cipher. The server SDK (or
// a custom adapter) supplies a real implementation.

import type { JSONSchema7 } from "json-schema";

import type { FulfillmentChannel } from "../../types.js";
import {
  ipfsPointerBuyerDataJsonSchema,
  ipfsPointerBuyerDataSchema,
  type IpfsPointerBuyerData,
} from "./schema.js";

export const IPFS_POINTER_CHANNEL_ID = "ipfs-pointer";

export interface IpfsPointerServerCfg {
  /** Persist `exchangeId → buyerData`. Defaults to an in-memory `Map`. */
  store?: Map<string, IpfsPointerBuyerData>;
  /** Server-side hook invoked from `onRedeem`. Returns the IPFS CID (no `ipfs://` prefix). */
  upload: (exchangeId: string, data: IpfsPointerBuyerData) => Promise<string>;
  /** Optional descriptor metadata (e.g. gateway hint) surfaced on the 402. */
  metadata?: unknown;
}

export type IpfsPointerChannel = FulfillmentChannel<IpfsPointerServerCfg, IpfsPointerBuyerData>;

export type { IpfsPointerBuyerData } from "./schema.js";
export { ipfsPointerBuyerDataJsonSchema, ipfsPointerBuyerDataSchema } from "./schema.js";

export function createIpfsPointerChannel(initialCfg?: IpfsPointerServerCfg): IpfsPointerChannel {
  let cfg: IpfsPointerServerCfg | undefined = initialCfg;
  let store: Map<string, IpfsPointerBuyerData> = initialCfg?.store ?? new Map();

  return {
    id: IPFS_POINTER_CHANNEL_ID,
    buyerDataSchema: ipfsPointerBuyerDataJsonSchema as JSONSchema7,
    configure(next) {
      cfg = next;
      store = next.store ?? new Map();
    },
    describe() {
      return {
        id: IPFS_POINTER_CHANNEL_ID,
        schema: ipfsPointerBuyerDataJsonSchema,
        ...(cfg?.metadata !== undefined ? { metadata: cfg.metadata } : {}),
      };
    },
    validate(data) {
      const result = ipfsPointerBuyerDataSchema.safeParse(data);
      return result.success
        ? { ok: true }
        : {
            ok: false,
            reason: result.error.issues[0]?.message ?? "invalid ipfs-pointer data",
          };
    },
    async onCommit(exchangeId, data) {
      store.set(exchangeId, data);
    },
    async onRedeem(exchangeId) {
      if (!cfg) {
        throw new Error("ipfs-pointer channel: configure({ upload }) before invoking onRedeem");
      }
      const data = store.get(exchangeId);
      if (!data) {
        throw new Error(`ipfs-pointer channel: no buyer data stored for exchange ${exchangeId}`);
      }
      const cid = await cfg.upload(exchangeId, data);
      return { kind: "async", pointer: `ipfs://${cid}` };
    },
  };
}
