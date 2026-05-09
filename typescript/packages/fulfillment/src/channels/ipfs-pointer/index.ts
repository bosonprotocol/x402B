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

import { createDataAtCommitChannel } from "../_internal/data-at-commit-channel.js";
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
  return createDataAtCommitChannel<IpfsPointerBuyerData, IpfsPointerServerCfg>(
    {
      id: IPFS_POINTER_CHANNEL_ID,
      zodSchema: ipfsPointerBuyerDataSchema,
      jsonSchema: ipfsPointerBuyerDataJsonSchema,
      hookName: "upload",
      dispatch: async (cfg, exchangeId, data) => {
        const cid = await cfg.upload(exchangeId, data);
        return `ipfs://${cid}`;
      },
    },
    initialCfg,
  );
}
