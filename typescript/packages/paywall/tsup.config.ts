import { defineConfig } from "tsup";

// Dual CJS + ESM build for the wrapper API (`generateHtml`, types,
// `PaywallProvider`). The React app itself is bundled separately by
// `src/build.ts` (esbuild → IIFE inlined into HTML) and consumed at
// runtime as the string constant in `src/gen/template.ts`, so tsup only
// needs to compile the thin TypeScript wrapper here.
//
// Important: the `prebuild` / `build:app` step in `package.json` must run
// before `tsup` so `src/gen/template.ts` exists when tsup type-checks the
// imports.
const entry = ["src/**/index.ts"];

// The React app is its own thing; do not bundle React into the wrapper.
// Consumers that import this package server-side never actually load
// React at runtime — only the inlined IIFE inside the generated HTML
// does, and that bundle is self-contained.
const EXTERNAL_DEPENDENCIES = ["react", "react-dom", "wagmi", "@tanstack/react-query"];

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
    external: EXTERNAL_DEPENDENCIES,
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
    external: EXTERNAL_DEPENDENCIES,
  },
]);
