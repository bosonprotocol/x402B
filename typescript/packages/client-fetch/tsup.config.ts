import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations. `entry` globs every
// `index.ts` under `src/`; this package currently has just `src/index.ts`,
// but the glob keeps additions purely additive. The `scripts/postbuild.mjs`
// step writes `dist/{esm,cjs}/package.json` module-type markers chained
// from `package.json`'s `build` script.
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
