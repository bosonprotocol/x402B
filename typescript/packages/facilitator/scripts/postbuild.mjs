#!/usr/bin/env node
// Post-build housekeeping after `tsup`:
//
// Write `dist/esm/package.json` ({"type":"module"}) and
// `dist/cjs/package.json` ({"type":"commonjs"}) so Node treats each
// subtree under the correct module dialect without a
// MODULE_TYPELESS_PACKAGE_JSON warning at consume time.
//
// This package ships no JSON schemas, so unlike core/fulfillment there is
// no `dist/schemas/` step.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const distRoot = join(here, "..", "dist");

await writeFile(
  join(distRoot, "esm", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
);
await writeFile(
  join(distRoot, "cjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

console.log("postbuild: wrote module-type markers in dist/{esm,cjs}/package.json");
