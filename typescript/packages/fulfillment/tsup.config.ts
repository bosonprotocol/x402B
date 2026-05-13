import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations.
//
// `entry` globs every `index.ts` under `src/`, including the root
// `src/index.ts`, so any subpath under `src/<subdir>/index.ts` builds as
// `@bosonprotocol/x402-fulfillment/<subdir>` without further config
// changes. JSON schemas under `src/**/schemas/*.json` are copied flat
// into `dist/schemas/` by the `postbuild` step chained from
// package.json's `build` script.
const entry = ["src/**/index.ts"];

// `splitting: false` keeps each `<subdir>/index` self-contained in
// the dist tree — without it, shared internal modules (e.g. the
// data-at-commit channel factory under `_internal/`) would be hoisted
// into hash-named chunks (`chunk-XXXXXXXX.js`) that would shift
// between releases. CLAUDE.md explicitly warns against deep-importing
// hashed filenames; producing them is the same anti-pattern.
export default defineConfig([
  {
    entry,
    format: "esm",
    outDir: "dist/esm",
    outExtension: () => ({ js: ".js" }),
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: false,
    target: "es2020",
    treeshake: true,
  },
  {
    entry,
    format: "cjs",
    outDir: "dist/cjs",
    outExtension: () => ({ js: ".js" }),
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    target: "es2020",
    treeshake: true,
  },
]);
