// Internal factory shared by the four "data-at-commit, async-delivery"
// channels (`email`, `xmtp`, `webhook`, `ipfs-pointer`).
//
// All four follow the same lifecycle — buyer attaches data at commit,
// server validates with a per-channel zod schema, persists by
// exchangeId, and at fulfill time runs a per-channel dispatch hook
// that produces an async-pointer string. Only the schema, the cfg
// shape, and the (dispatch + pointer-derivation) lambda differ.
//
// `inline` is intentionally NOT factored through here — it has no
// store, no zod schema, and returns an inline body, so the shared
// shape doesn't fit.
//
// The factory's generic constraint is inlined (rather than expressed
// via an exported `DataAtCommitBaseCfg<T>` interface) so the public
// types of each channel stay fully self-contained — no shared
// definitions chunk leaks into the published `.d.ts` files.

import type { z } from "zod";

import type { FulfillmentChannel } from "../../types.js";

export interface DataAtCommitChannelDef<
  TBuyerData,
  TServerCfg extends {
    store?: Map<string, TBuyerData>;
    metadata?: unknown;
  },
> {
  /** Stable wire-format identifier — also used in error messages. */
  id: string;
  /** Runtime validation source of truth. */
  zodSchema: z.ZodType<TBuyerData>;
  /** JSON Schema artifact (already derived) surfaced on `describe()`. */
  jsonSchema: Record<string, unknown>;
  /**
   * Hint at the missing config field name surfaced in the
   * "configure({ <hookName> }) before invoking onFulfill" error so
   * channel implementors don't have to hand-write that string.
   */
  hookName: string;
  /**
   * Run the channel's dispatch hook and return the async pointer.
   * Implementations are 1–2 lines: read the per-channel hook off
   * `cfg`, call it, derive the pointer string.
   */
  dispatch: (cfg: TServerCfg, exchangeId: string, data: TBuyerData) => Promise<string>;
}

export function createDataAtCommitChannel<
  TBuyerData,
  TServerCfg extends {
    store?: Map<string, TBuyerData>;
    metadata?: unknown;
  },
>(
  def: DataAtCommitChannelDef<TBuyerData, TServerCfg>,
  initialCfg?: TServerCfg,
): FulfillmentChannel<TServerCfg, TBuyerData> {
  let cfg: TServerCfg | undefined = initialCfg;
  let store: Map<string, TBuyerData> = initialCfg?.store ?? new Map();

  return {
    id: def.id,
    buyerDataSchema: def.jsonSchema,
    configure(next) {
      cfg = next;
      store = next.store ?? new Map();
    },
    describe() {
      return {
        id: def.id,
        schema: def.jsonSchema,
        ...(cfg?.metadata !== undefined ? { metadata: cfg.metadata } : {}),
      };
    },
    validate(data) {
      const result = def.zodSchema.safeParse(data);
      return result.success
        ? { ok: true }
        : {
            ok: false,
            reason: result.error.issues[0]?.message ?? `invalid ${def.id} data`,
          };
    },
    async onCommit(exchangeId, data) {
      store.set(exchangeId, data);
    },
    async onFulfill(exchangeId) {
      if (!cfg) {
        throw new Error(
          `${def.id} channel: configure({ ${def.hookName} }) before invoking onFulfill`,
        );
      }
      const data = store.get(exchangeId);
      if (!data) {
        throw new Error(`${def.id} channel: no buyer data stored for exchange ${exchangeId}`);
      }
      const pointer = await def.dispatch(cfg, exchangeId, data);
      return { kind: "async", pointer };
    },
  };
}
