# @bosonprotocol/x402-server-express

Express 4/5 adapter for
[`@bosonprotocol/x402-server`](../x402-server) — provides a
[`mountX402b(server)`](./src/mount.ts) router that wires the convenience
handlers to `/x402B/*` routes, plus
[`expressMiddleware`](./src/middleware.ts) for protecting an
existing route with a 402 challenge.

See [`docs/boson-impl-05-server-sdk.md`](../../../docs/boson-impl-05-server-sdk.md)
for the spec.

## Install

```sh
pnpm add @bosonprotocol/x402-server-express @bosonprotocol/x402-server express
```

## Quick start

```ts
import express from "express";
import { createX402bServer } from "@bosonprotocol/x402-server";
import { mountX402b, expressMiddleware } from "@bosonprotocol/x402-server-express";

const server = createX402bServer({ /* ... */ });

const app = express();
app.use(express.json());
app.use(mountX402b(server, { resolveRequirements: req => /* … */ }));

app.get("/datafeed", expressMiddleware(server, {
  resolveRequirements: req => /* … */,
}), async (req, res) => {
  res.json({ kpi: 42 });
});

app.listen(3000);
```

The mounted router exposes:

- `POST /x402B/commit` — Flow A (deferred-redeem) commit.
- `POST /x402B/commit-and-redeem` — Flow B (atomic) commit + redeem.
- `POST /x402B/redeem`
- `POST /x402B/complete`
- `POST /x402B/dispute/raise`
- `POST /x402B/dispute/resolve`
- `POST /x402B/dispute/retract`
- `POST /x402B/dispute/escalate`
- `POST /x402B/withdraw-funds`
- `GET /x402B/available-funds`

When `basePath` is omitted, the router also registers legacy `/x402b/*`
aliases for backward compatibility. Passing `basePath` registers only
that explicit path.

Each route returns `{ exchangeId?, txHash, nextActions }` on success
or a structured `{ code, reason, details? }` error body on failure.

## License

[Apache-2.0](./LICENSE)
