import { defineConfig } from "tsup";

// Dual CJS + ESM build with type declarations. Mirrors the convention used
// by sibling x402B packages (see e.g. `client-fetch/tsup.config.ts`): the
// `entry` glob picks every `index.ts` under `src/` so future subpaths are
// purely additive, and `scripts/postbuild.mjs` writes the
// `dist/{esm,cjs}/package.json` module-type markers.
const shared = {
  entry: ["src/**/index.ts"],
  outExtension: () => ({ js: ".js" }),
  sourcemap: true,
  target: "es2020" as const,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    format: "esm",
    outDir: "dist/esm",
    dts: false,
    clean: true,
  },
  {
    ...shared,
    format: "cjs",
    outDir: "dist/cjs",
    dts: true,
    clean: false,
  },
]);
