import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations.
// JSON schemas under src/**/schemas/*.json are copied to dist/schemas/ so
// consumers can resolve them via `@bosonprotocol/x402-core/schemas/<name>.json`
// once schemas are added (PR 3).
export default defineConfig([
  {
    entry: ["src/index.ts"],
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
    entry: ["src/index.ts"],
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
