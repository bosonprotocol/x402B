# CLAUDE.md

Guidance for Claude Code when working in this repository. These rules are
distilled from feedback the maintainers have given during prior sessions —
follow them by default; the user can override on a case-by-case basis.

## What this repo is

x402B is the Boson Protocol implementation of the
[`x402-escrow-schema`](https://github.com/bosonprotocol/x402-escrow-schema):
a non-custodial escrow payment scheme for x402 HTTP servers. The codebase
is a pnpm + Turbo monorepo whose folder structure intentionally mirrors
[`x402-foundation/x402`](https://github.com/x402-foundation/x402);
TypeScript packages live under `typescript/packages/*` and publish under
the `@bosonprotocol/x402-*` scope.

The implementation specification lives in [`docs/`](./docs/) — start with
[`boson-impl-00-overview.md`](./docs/boson-impl-00-overview.md).

## Workflow rules

### Pause for local review before any git/GitHub action

Do **not** run `git commit`, `git push`, or `gh pr create` until the
maintainer has explicitly reviewed the changes locally and approved.
Selecting an option from a multi-choice question (e.g. "land it as
follow-up commit") is **not** approval to commit — it's a strategy
choice; ask separately for the green light to actually push.

After making changes:

1. Run the local verification (`pnpm build && pnpm test && pnpm lint && pnpm format:check`).
2. Summarize what changed (file paths, key edits) — link back to spec /
   issue / earlier turn where applicable.
3. Wait for explicit approval ("looks good", "go ahead", "ship it", etc.)
   before touching git.

Local-only actions (build, test, lint, format, dry-runs) don't need
approval.

### PR bodies — scope to the current change

A PR description covers **only** the change this PR makes. Do **not**
include sections enumerating or describing follow-up / upcoming PRs in
a staged rollout. Cross-link related plans / issues / dependent PRs
where useful, but the body shouldn't preview work that hasn't shipped.
Same for commit messages — describe what the commit does, not what's
coming next.

### Branch names

Descriptive kebab-case naming (`setup-monorepo`, `add-escrow-scheme`,
`fix-ci-disable-release`). Avoid auto-generated branch ids and one-word
or overly generic names.

### Staged PRs

Large work ships as several small, narrowly-scoped PRs that touch
separate files where possible — easier to review, fewer merge
conflicts. When PR B depends on unmerged PR A, open B as a **draft**
with PR A's branch as its base; GitHub auto-rebases the base to `main`
when A merges.

## Code conventions

### Reuse > re-implementation

x402B is an extension that runs alongside x402 — favour wrapping the
established libraries over re-deriving their primitives:

- **`@bosonprotocol/core-sdk`** — protocol-level types (`ExchangeState`,
  `DisputeState`, `FullOfferArgs`, …), EIP-712 typed-data builders
  (`exchanges.handler.signFullOffer`, `metaTx.handler.signMetaTx`),
  and on-chain helpers. When a builder doesn't expose a
  `returnTypedDataToSign` mode, route through it with a stub
  `Web3LibAdapter` that intercepts the `eth_signTypedData_v4` RPC to
  capture typed-data — this stays in lock-step with the deployed
  protocol.
- **`@x402/core` and `@x402/evm`** — base x402 protocol types and the
  EVM scheme primitives. Re-export what their public exports map
  exposes; **don't** deep-import hashed chunk filenames
  (`@x402/evm/dist/cjs/permit2-Gc2YHDZi.js`) — they're build-output
  hashes that shift between releases.

When reuse isn't possible (the upstream package doesn't publicly export
what we need, or the type-list itself is part of a fixed public
standard like EIP-3009 / EIP-2612 / Permit2), hand-mirror the minimum
necessary and document why inline.

### Production over spec when they diverge

The deployed protocol is ground truth. Preferred sources of truth, in
order, are:

1. **`@bosonprotocol/core-sdk`** (and its `subgraph.ts` / dist `.d.ts`)
   for protocol-level types, enums, EIP-712 domains, and typed-data
   shapes.
2. **The contracts and supporting packages under
   [`github.com/bosonprotocol`](https://github.com/bosonprotocol/)** for
   anything not surfaced by core-sdk (raw ABIs, on-chain enums,
   contract-level constants, BPIP specifications).
3. **The spec docs in [`docs/`](./docs/)** for design intent, flows,
   and `nextActions` semantics.

If you discover a discrepancy between (1) / (2) and (3) — e.g. the
spec doc claims a field name or a state value that the deployed
protocol doesn't use — **stop and notify the developer**. Surface
exactly what diverges, where each source says what, and what the
implementation needs in order to match production. Wait for a decision
before continuing. If the spec docs are wrong or misleading, update
them in the **same PR** that fixes the implementation, so the
discrepancy doesn't outlive the fix.

### Naming

- Use **"escrow"** in user-facing types and wire-format field names
  (`escrowAddress`, `onchainHints.escrow`). Internal architecture term
  "Diamond" stays only in deep-link references to specific Boson
  facets / contracts (e.g. `MetaTransactionsHandlerFacet`).
- Future actions / states / fields tracked but not yet stable: document
  them in spec docs and JSDoc, but do **not** add them to the actual
  `ACTION_IDS` / enum value lists until the corresponding on-chain
  primitives ship.

### Comments

- Don't pin exact dependency versions in source comments
  (`@bosonprotocol/core-sdk@1.46.1` → just `@bosonprotocol/core-sdk`).
  Version-specific behaviour belongs in the lockfile + commit messages,
  not in code that reads stale.
- Move duplicated constants / regexes / zod schemas into a shared file
  the moment they appear in two places.

## Build, test, release

### Per-package

Every workspace package builds with **tsup** (dual CJS + ESM, `.js`
extension for both formats so the `exports` map resolves cleanly).
After `tsup`, a `postbuild.mjs` step writes
`dist/{esm,cjs}/package.json` module-type markers (silences Node's
`MODULE_TYPELESS_PACKAGE_JSON` warning at consume time) and copies any
JSON schemas under `src/**/schemas/` into `dist/schemas/`.

Tests use **vitest**. The package-level `test` script passes
`--passWithNoTests` so empty packages don't fail CI.

### CI

GitHub Actions matrix on the currently-supported LTS Node versions.
Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at the workflow level to
opt JS-action runtimes onto Node 24 ahead of GitHub's June 2026 forced
migration so `actions/checkout` / `actions/setup-node` /
`pnpm/action-setup` don't print Node-20 deprecation warnings.

### Release

[changesets](https://github.com/changesets/changesets) handles
versioning. The release workflow is **disabled** (trigger:
`workflow_dispatch` only) until at least one `@bosonprotocol/x402-*`
package is publish-ready; once it is, restore the `push: branches: [main]`
trigger and add `NPM_TOKEN` to GitHub Actions secrets.

## When in doubt

- Read the spec doc in [`docs/`](./docs/) before designing.
- Run the full local verification before claiming a change is done.
- Ask before pushing.
