#!/usr/bin/env node
// Post-build housekeeping after `tsup`:
//
// 1. Copy `src/**/schemas/*.json` flat into `dist/schemas/` so the
//    `./schemas/*` package export resolves at runtime.
// 2. Write `dist/esm/package.json` ({"type":"module"}) and
//    `dist/cjs/package.json` ({"type":"commonjs"}) so Node treats each
//    subtree under the correct module dialect without a
//    MODULE_TYPELESS_PACKAGE_JSON warning at consume time.

import { readdir, mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = join(here, "..", "src");
const distRoot = join(here, "..", "dist");
const schemasRoot = join(distRoot, "schemas");

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Wipe `dist/schemas/` first so renamed or removed source schemas don't
// leak into published tarballs.
await rm(schemasRoot, { recursive: true, force: true });
await mkdir(schemasRoot, { recursive: true });

// Track basenames as we go so two `src/**/schemas/<name>.json` files
// from different subdirectories don't silently overwrite each other in
// the flat `dist/schemas/` layout. The `./schemas/*` package export
// resolves on basename, so duplicates would produce a non-deterministic
// published artifact — fail the build instead.
let schemaCount = 0;
const seenSchemaNames = new Set();
for await (const file of walk(srcRoot)) {
  if (!file.endsWith(".json")) continue;
  const rel = relative(srcRoot, file);
  if (!rel.split(/[\\/]/).includes("schemas")) continue;
  const name = file.split(/[\\/]/).pop();
  if (!name) continue;
  if (seenSchemaNames.has(name)) {
    throw new Error(
      `postbuild: duplicate schema basename '${name}' found while flattening into dist/schemas/. ` +
        `Use a unique filename for each schema (or update the script to preserve subpaths).`,
    );
  }
  seenSchemaNames.add(name);
  await copyFile(file, join(schemasRoot, name));
  schemaCount += 1;
}

await writeFile(
  join(distRoot, "esm", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
);
await writeFile(
  join(distRoot, "cjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

console.log(
  `postbuild: ${schemaCount} schema(s) -> ${relative(process.cwd(), schemasRoot)}, wrote module-type markers in dist/{esm,cjs}/package.json`,
);
