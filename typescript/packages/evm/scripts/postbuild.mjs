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

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const distRoot = join(here, "..", "dist");
const esmDir = join(distRoot, "esm");
const cjsDir = join(distRoot, "cjs");

// Ensure both dialect subtrees exist before writing markers. `tsup`
// creates them today, but a future config change (e.g. dropping one
// format) shouldn't make postbuild crash with ENOENT.
await Promise.all([mkdir(esmDir, { recursive: true }), mkdir(cjsDir, { recursive: true })]);

await writeFile(join(esmDir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
await writeFile(join(cjsDir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");

console.log("postbuild: wrote module-type markers in dist/{esm,cjs}/package.json");
