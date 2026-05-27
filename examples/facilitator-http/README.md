# facilitator-http

Reference Express host for
[`@bosonprotocol/x402-facilitator-express`](../../typescript/packages/facilitator-express).
Boots a working facilitator HTTP service from environment variables —
mounts `POST /verify`, `POST /settle`, `POST /perform-action`
under the root path and exposes a `GET /health` probe.

Doubles as the runtime image used by the x402B e2e suite.

## Endpoints

| Route | Source |
|---|---|
| `GET  /health`         | This package. Liveness probe. |
| `POST /verify`         | `mountFacilitator` from `@bosonprotocol/x402-facilitator-express`. |
| `POST /settle`         | Same. |
| `POST /perform-action` | Same. |

Route semantics, error codes, and request/response shapes are defined
in [`docs/boson-impl-07-facilitator.md`](../../docs/boson-impl-07-facilitator.md);
this host adds no protocol logic of its own.

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `FACILITATOR_URL` | yes | — | Public URL the service is reachable at. Populates `nextActions[].endpoints.facilitator`. |
| `RPC_NODE`        | yes | — | JSON-RPC endpoint the relayer broadcasts through. |
| `CHAIN_ID`        | no  | `31337` | Numeric chain id of the network. |
| `ESCROW_ADDRESS`  | yes | — | Boson Diamond on the configured chain; the only contract the relayer will sponsor gas for. |
| `RELAYER_PK`      | yes | — | Relayer private key (`0x`-prefixed 32-byte hex). |
| `PORT`            | no  | `8889`  | HTTP listen port. Avoids `8888` (canonical meta-tx-gateway port). |

## Run locally

```sh
pnpm build  # build workspace deps once
FACILITATOR_URL=http://localhost:8889 \
RPC_NODE=http://localhost:8545 \
ESCROW_ADDRESS=0x... \
RELAYER_PK=0x... \
pnpm --filter @bosonprotocol/x402-example-facilitator-http start
```

## Run in Docker

Build context is the **repo root** — the workspace lockfile and the
`@bosonprotocol/x402-facilitator{,-express}` source must be visible to
the build:

```sh
docker build -t x402b-facilitator-http -f examples/facilitator-http/Dockerfile .
docker run --rm -p 8889:8889 \
  --add-host=host.docker.internal:host-gateway \
  -e FACILITATOR_URL=http://localhost:8889 \
  -e RPC_NODE=http://host.docker.internal:8545 \
  -e ESCROW_ADDRESS=0x... \
  -e RELAYER_PK=0x... \
  x402b-facilitator-http
```

## Embed in your own Express app

If you already have an Express app, skip this host and use the adapter
directly:

```ts
import express from "express";
import { mountFacilitator } from "@bosonprotocol/x402-facilitator-express";

const app = express();
app.use(express.json());
app.use("/v1", mountFacilitator(yourFacilitatorConfig));
app.listen(8889);
```
