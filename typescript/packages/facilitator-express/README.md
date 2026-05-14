# @bosonprotocol/x402-facilitator-express

Express adapter for [`@bosonprotocol/x402-facilitator`](../facilitator).
Mounts the three facilitator endpoints (`POST /verify`, `POST /settle`,
`POST /perform-action`) as a single Express router, so an operator can
run a working facilitator HTTP service with a few lines of glue.

```ts
import express from "express";
import { mountFacilitator } from "@bosonprotocol/x402-facilitator-express";

const app = express();
app.use(express.json());
app.use(mountFacilitator(facilitatorConfig));
app.listen(3000);
```

To mount under a prefix, use Express's normal router mounting:

```ts
app.use("/v1", mountFacilitator(facilitatorConfig));
```

Routes follow the spec in [`docs/boson-impl-07-facilitator.md`](../../../docs/boson-impl-07-facilitator.md);
this package adds no protocol logic of its own.
