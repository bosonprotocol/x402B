// Shared path constants for the stack helpers. Anchors `compose.yaml`
// at `src/stack/compose.yaml` regardless of where the caller's CWD is
// (vitest runs from the package root, but `pnpm stack:up` could be
// invoked from anywhere).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to `src/stack/compose.yaml`. */
export const COMPOSE_FILE = resolve(here, "compose.yaml");
