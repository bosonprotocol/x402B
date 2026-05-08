import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations. Each public subpath of the
// package gets its own entry so consumers resolving e.g.
// `@bosonprotocol/x402-core/state-machine` get a separate file per format.
const entry = ["src/index.ts", "src/state-machine/index.ts"];

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
