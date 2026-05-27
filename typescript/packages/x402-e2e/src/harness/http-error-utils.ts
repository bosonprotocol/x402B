// Shared helpers for the harness's HTTP error types
// (`PostCommitActionError`, `FacilitatorPerformError`). Kept internal
// to the harness — not re-exported from the package's public `index.ts`.

/**
 * `JSON.stringify(value)` that falls back to `String(value)` when the
 * value contains a cycle or otherwise can't be serialised. Used to
 * build error messages from parsed HTTP error envelopes without
 * letting a stringify failure mask the original HTTP error.
 *
 * `JSON.stringify` returns `undefined` (not a string) for top-level
 * `undefined` / function / symbol values without throwing, so the
 * null-coalesce on the success path is required to honour the
 * `: string` return type.
 */
export function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}
