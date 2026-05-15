# resource-server

Reference Express host for
[`@bosonprotocol/x402-server-express`](../../typescript/packages/server-express).
Boots a working x402B resource server from environment variables —
mounts the nine `POST /x402B/*` convenience routes (plus the
lowercase legacy aliases), gates `GET /resource` with an
`expressMiddleware`-driven 402 challenge, and exposes `GET /health`
and `GET /config` probes.

Doubles as the runtime image used by the x402B e2e suite (the suite
imports `createResourceServerApp` directly and injects a real
`ExchangeReader`).

## Routes

| Route | Source |
|---|---|
| `GET  /health`                    | This package. Liveness probe. |
| `GET  /config`                    | This package. Echoes the current `PaymentRequirements` for debugging. |
| `GET  /resource`                  | `expressMiddleware`. Returns 402 + challenge on first call; on a valid `X-PAYMENT` retry, runs the commit handler and returns the gated resource. |
| `POST /x402B/commit`              | `mountX402b`. Flow A — deferred commit. |
| `POST /x402B/commit-and-redeem`   | `mountX402b`. Flow B — atomic commit-and-redeem. |
| `POST /x402B/redeem`              | `mountX402b`. |
| `POST /x402B/complete`            | `mountX402b`. |
| `POST /x402B/dispute/{raise,resolve,retract,escalate}` | `mountX402b`. |
| `POST /x402B/withdraw-funds`      | `mountX402b`. |
| `GET  /x402B/available-funds`     | `mountX402b`. |
| (lowercase `/x402b/*` aliases)    | Also registered for legacy clients. |

Route semantics, error codes, and request/response shapes are defined
by [`@bosonprotocol/x402-server`](../../typescript/packages/server) and
[`@bosonprotocol/x402-server-express`](../../typescript/packages/server-express);
this host adds no protocol logic of its own.

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `RESOURCE_SERVER_URL` | yes | — | Public URL the host is reachable at. Stamped into each `nextActions[].endpoints.server` so buyers know where to send post-commit actions. |
| `RPC_NODE`            | yes | — | JSON-RPC endpoint. Carried for parity with the other examples; unused by the demo until a subgraph-backed `exchangeReader` lands. |
| `CHAIN_ID`            | no  | `31337` | Numeric chain id. `network` is derived as `eip155:<chainId>`. |
| `ESCROW_ADDRESS`      | yes | — | Boson Diamond on the configured chain. |
| `FACILITATOR_URL`     | yes | — | URL the server forwards `verify` / `settle` / `perform-action` to. |
| `SELLER_PK`           | yes | — | Seller signing key (`0x`-prefixed 32-byte hex). Signs FullOffers. |
| `SELLER_ID`           | yes | — | Boson seller entity id (decimal string). |
| `DISPUTE_RESOLVER_ID` | yes | — | Boson dispute resolver entity id. |
| `ASSET_ADDRESS`       | yes | — | ERC-20 token the buyer pays in (`exchangeToken`). |
| `AMOUNT`              | yes | — | Atomic-units price advertised in the 402 challenge. |
| `MAX_TIMEOUT_SECONDS` | no  | `3600` | `PaymentRequirements.maxTimeoutSeconds`. Capped at 24 h. |
| `SUBGRAPH_URL`        | no  | — | Optional Boson subgraph URL — required for `getAvailableFunds` / `withdrawFunds`. |
| `PORT`                | no  | `4001` | HTTP listen port. |

## Run locally

```sh
pnpm build  # build the workspace deps once

RESOURCE_SERVER_URL=http://localhost:4001 \
RPC_NODE=http://localhost:8545 \
ESCROW_ADDRESS=0x... \
FACILITATOR_URL=http://localhost:8889 \
SELLER_PK=0x... \
SELLER_ID=12345 \
DISPUTE_RESOLVER_ID=1 \
ASSET_ADDRESS=0x... \
AMOUNT=1000000 \
pnpm --filter @bosonprotocol/x402-example-resource-server start
```

Then `curl http://localhost:4001/resource` returns 402 + the
`PaymentRequirements` echoed from your env.

## Run in Docker

Build context is the **repo root** — the workspace lockfile and the
`@bosonprotocol/x402-server{,-express}` source must be visible to the
build:

```sh
docker build -t x402b-resource-server -f examples/resource-server/Dockerfile .
docker run --rm -p 4001:4001 \
  --add-host=host.docker.internal:host-gateway \
  -e RESOURCE_SERVER_URL=http://localhost:4001 \
  -e RPC_NODE=http://host.docker.internal:8545 \
  -e ESCROW_ADDRESS=0x... \
  -e FACILITATOR_URL=http://host.docker.internal:8889 \
  -e SELLER_PK=0x... \
  -e SELLER_ID=12345 \
  -e DISPUTE_RESOLVER_ID=1 \
  -e ASSET_ADDRESS=0x... \
  -e AMOUNT=1000000 \
  x402b-resource-server
```

## Wire up `ExchangeReader` before exercising write handlers

The example ships a **placeholder `ExchangeReader`** that returns `null`
and logs a warning. The 402 challenge path doesn't touch it, so the
binary boots and serves `GET /resource` without further configuration.
The write handlers (`commit`, `redeem`, `complete`, `dispute/*`)
verify the post-settle on-chain state through the reader, and **will
fail with `EXCHANGE_NOT_FOUND`** until you replace the stub.

Two options:

- **Programmatic injection** — for tests / embedded scenarios, import
  `createResourceServerApp` directly and pass
  `{ exchangeReader: yourReader }` in the second argument. The
  x402B e2e suite uses this path.
- **Fork this example** — swap
  [`src/exchange-reader.ts`](./src/exchange-reader.ts) for a real
  subgraph-backed (`coreSDK.getExchangeById`) or RPC-backed
  (`publicClient.readContract`) reader.

## Embed in your own Express app

If you already have an Express app, skip this host and use the
adapter directly:

```ts
import express from "express";
import { createX402bServer } from "@bosonprotocol/x402-server";
import { expressMiddleware, mountX402b } from "@bosonprotocol/x402-server-express";

const server = createX402bServer(yourConfig);

const app = express();
app.use(express.json());
app.get(
  "/resource",
  expressMiddleware(server, { resolveRequirements: yourResolver }),
  (req, res) => res.json({ ok: true, x402b: res.locals.x402b }),
);
app.use(mountX402b(server, { resolveRequirements: yourResolver }));
app.listen(4001);
```
