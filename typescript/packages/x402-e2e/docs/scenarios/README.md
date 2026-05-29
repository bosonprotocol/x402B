# x402B scenario walkthroughs

These docs explain **how x402B actually behaves**, using the end-to-end
test suite as the worked example. Where the spec docs in the repo-root
[`docs/`](../../../../../docs/boson-impl-00-overview.md) describe the
protocol in the abstract, each file here narrates a concrete protocol
**flow** as a timeline — who talks to whom, in what order, with what
payloads — and maps every step back to the **real method** in the
harness, the SDK, the server/facilitator, and the Boson Diamond, so you
can jump from "what happens" to "where it's coded".

The suite itself lives one level up under
[`test/scenarios/`](../../test/scenarios/); the buyer/seller/asserter
personas it drives live under [`src/harness/`](../../src/harness/).

## How to read these

Every flow doc follows the same structure:

1. **Overview & context** — what the flow is for, and the e2e scenarios
   that exercise it (with links to the exact `test:line`).
2. **Actors** — the participants, each mapped to the code object that
   plays it in the suite.
3. **Sequence diagram** — a Mermaid `sequenceDiagram` annotated with the
   real method on each arrow.
4. **Step-by-step walkthrough** — per step: the method called, the
   request/response **payload** on the wire, and the **assertion** the
   test makes there.
5. **Payload appendix** — concrete example bodies (402
   `PaymentRequirements`, decoded `X-PAYMENT`, `X-PAYMENT-RESPONSE`,
   post-commit request/response, `nextActions`).
6. **Code map** — a table: logical step → harness → SDK/server/
   facilitator → Boson Diamond facet method.
7. **Failure modes** — the negative (C-series) / operational (F-series)
   scenarios that probe this flow's guards.

The four protocol flows are the same A/B/C/D used in
[`docs/boson-impl-02-flows.md`](../../../../../docs/boson-impl-02-flows.md).
The e2e suite's letter-numbered scenarios (A1, B4, C2, …) are grouped
under whichever flow they exercise:

| Flow doc | Protocol flow | e2e scenarios |
|---|---|---|
| [`flow-a-deferred-commit.md`](./flow-a-deferred-commit.md) | Deferred commit, redeem later | A1/A3/A4/A5 commit, B1 redeem, A6 fulfillment, B7 cancel |
| `flow-b-atomic-commit-redeem.md` _(planned)_ | Atomic commit-and-redeem | A2, B2 completeExchange |
| [`flow-c-dispute.md`](./flow-c-dispute.md) | Dispute path | B3 raise, B4 resolve (50/50), B6 retract, E3 dual-sig |
| `flow-d-channels-nextactions.md` _(planned)_ | Channel fallback + `nextActions` | B7 via facilitator, D1/D2 |

> **Status:** pilot. `flow-a` and `flow-c` are written; `flow-b` and
> `flow-d` follow once the format is settled.

## Sources of truth

These docs paraphrase wire shapes from the packages that own them; when
they diverge, the code wins. The canonical definitions are:

- **402 `PaymentRequirements`** — [`core/src/schemes/escrow/payment-requirements.ts`](../../../core/src/schemes/escrow/payment-requirements.ts)
- **`X-PAYMENT` payload** — [`core/src/schemes/escrow/payment-payload.ts`](../../../core/src/schemes/escrow/payment-payload.ts)
- **`nextActions` envelope + action IDs** — [`docs/boson-impl-04-state-machine-and-next-actions.md`](../../../../../docs/boson-impl-04-state-machine-and-next-actions.md), backed by `@bosonprotocol/x402-core/state-machine`
- **Server convenience routes** — [`server-express/src/mount.ts`](../../../server-express/src/mount.ts)
- **Facilitator perform-action** — [`facilitator/src/perform-action/index.ts`](../../../facilitator/src/perform-action/index.ts)
