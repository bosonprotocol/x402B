# webhook-sink

Minimal Express service that captures POST bodies. Used by the x402B
e2e test suite to verify the `webhook` fulfillment channel — without
a callback endpoint to receive `onCommit` / `onFulfill` payloads,
that channel can't be exercised end-to-end.

Not a reference for production use. It has no auth, persists nothing,
and stores received bodies in memory.

## Endpoints

| Route | Purpose |
|---|---|
| `GET  /health`    | Liveness probe. Returns `{ ok: true }`. |
| `POST /hook`      | Stores the JSON request body. Returns `204`. |
| `GET  /received`  | Returns the array of stored bodies. |
| `DELETE /received`| Clears the in-memory store. Returns `204`. |

## Run locally

```sh
pnpm --filter @bosonprotocol/x402-example-webhook-sink start
# PORT=4000 by default
```

## Run in Docker

Build from the **repo root** so the monorepo `pnpm-lock.yaml` is in the
build context — the image installs deps with `pnpm --frozen-lockfile`
against that lockfile, so versions stay pinned to whatever the workspace
resolved.

```sh
docker build -t x402b-webhook-sink -f examples/webhook-sink/Dockerfile .
docker run --rm -p 4000:4000 x402b-webhook-sink
```
