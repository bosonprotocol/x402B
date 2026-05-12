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
  /** Server-side hook invoked from `onFulfill`. Returns the IPFS CID (no `ipfs://` prefix). */
  upload: (exchangeId: string, data: IpfsPointerBuyerData) => Promise<string>;
  /** Optional descriptor metadata (e.g. gateway hint) surfaced on the 402. */
  metadata?: unknown;
}

export type IpfsPointerChannel = FulfillmentChannel<IpfsPointerServerCfg, IpfsPointerBuyerData>;

export type { IpfsPointerBuyerData } from "./schema.js";
export { ipfsPointerBuyerDataJsonSchema, ipfsPointerBuyerDataSchema } from "./schema.js";

// Multibase CIDs (v0 or v1) use a small alphabet — alphanumerics for
// base58btc and base32. We don't bind to a specific multibase here
// (the upload adapter is free to use either), so the check stays a
// permissive non-empty, no-whitespace, no-slash guard.
const CID_CHARS = /^[A-Za-z0-9]+$/;

function sanitizeCid(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError("ipfs-pointer channel: upload() must resolve to a string CID");
  }
  // Strip any common prefix the adapter may have added so the channel
  // owns a single `ipfs://` namespacing.
  const stripped = raw
    .trim()
    .replace(/^ipfs:\/\//, "")
    .replace(/^\/ipfs\//, "")
    .replace(/^\/+/, "");
  if (stripped.length === 0) {
    throw new Error("ipfs-pointer channel: upload() returned an empty CID");
  }
  if (!CID_CHARS.test(stripped)) {
    throw new Error(`ipfs-pointer channel: upload() returned an invalid CID "${raw}"`);
  }
  return stripped;
}

export function createIpfsPointerChannel(initialCfg?: IpfsPointerServerCfg): IpfsPointerChannel {
  return createDataAtCommitChannel<IpfsPointerBuyerData, IpfsPointerServerCfg>(
    {
      id: IPFS_POINTER_CHANNEL_ID,
      zodSchema: ipfsPointerBuyerDataSchema,
      jsonSchema: ipfsPointerBuyerDataJsonSchema,
      hookName: "upload",
      dispatch: async (cfg, exchangeId, data) => {
        const cid = sanitizeCid(await cfg.upload(exchangeId, data));
        return `ipfs://${cid}`;
      },
    },
    initialCfg,
  );
}
