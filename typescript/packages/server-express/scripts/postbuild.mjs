#!/usr/bin/env node
// Post-build housekeeping: write module-type markers in dist/{esm,cjs}/.
// No schemas in this package; mirrors the facilitator package's postbuild.

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
