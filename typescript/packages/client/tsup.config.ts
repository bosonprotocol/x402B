import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations.
//
// `entry` globs every `index.ts` under `src/`, including the root
// `src/index.ts`, so any subpath under `src/<subdir>/index.ts` builds as
// `@bosonprotocol/x402-client/<subdir>` without further config changes.
// The `scripts/postbuild.mjs` step writes `dist/{esm,cjs}/package.json`
// module-type markers chained from `package.json`'s `build` script.
const entry = ["src/**/index.ts"];

export default defineConfig([
  {
    entry,
    format: "esm",
    outDir: "dist/esm",
    outExtension: () => ({ js: ".js" }),
    dts: false,
    sourcemap: true,
    clean: true,
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
    target: "es2020",
    treeshake: true,
  },
]);
