# @bosonprotocol/x402-facilitator-express

Express adapter for [`@bosonprotocol/x402-facilitator`](https://github.com/bosonprotocol/x402B/tree/main/typescript/packages/facilitator).
Mounts the three facilitator endpoints (`POST /verify`, `POST /settle`,
`POST /perform-action`) as a single Express router, so an operator can
run a working facilitator HTTP service with a few lines of glue.

`mountFacilitator` accepts a `FacilitatorConfig` object from
[`@bosonprotocol/x402-facilitator`](https://github.com/bosonprotocol/x402B/blob/main/typescript/packages/facilitator/src/types.ts).
It does not take adapter options; use Express's normal router mounting to add a
path prefix.

```ts
import express from "express";
import { mountFacilitator } from "@bosonprotocol/x402-facilitator-express";

const app = express();
app.use(express.json());
app.use(mountFacilitator(facilitatorConfig));
app.listen(3000);
```

Install `express.json()` before the adapter so Express populates `req.body`.
Without it, the adapter's `INVALID_REQUEST_BODY` guard returns HTTP 400 before
the facilitator handlers run.

To mount under a prefix, use Express's normal router mounting:

```ts
app.use("/v1", mountFacilitator(facilitatorConfig));
```

Routes follow the spec in [`docs/boson-impl-07-facilitator.md`](https://github.com/bosonprotocol/x402B/blob/main/docs/boson-impl-07-facilitator.md);
this package adds no protocol logic of its own.
