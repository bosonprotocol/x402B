import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations. Mirrors the convention used
// by sibling x402B packages (see e.g. `client-fetch/tsup.config.ts`): the
// `entry` glob picks every `index.ts` under `src/` so future subpaths are
// purely additive, and `scripts/postbuild.mjs` writes the
// `dist/{esm,cjs}/package.json` module-type markers.
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
