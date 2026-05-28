// CJS-interop shim for `selfsigned`.
//
// The package ships no first-class ESM entry today: its bundled types
// declare `generate` without exporting it, and depending on the
// runtime resolution path the function is reachable either as the
// default export or as a named property. Isolating the cast here
// keeps the brittle duck-typing in one place; `app.ts` calls
// `generateSelfSignedCert` instead of importing `selfsigned` directly.

type SelfSignedAttrs = ReadonlyArray<{ name: string; value: string }>;
type SelfSignedOptions = { days?: number; keySize?: number; algorithm?: string };
type SelfSignedPems = { private: string; cert: string };
type SelfSignedGenerate = (attrs?: SelfSignedAttrs, opts?: SelfSignedOptions) => SelfSignedPems;

export async function generateSelfSignedCert(
  attrs: SelfSignedAttrs,
  opts: SelfSignedOptions,
): Promise<SelfSignedPems> {
  const selfsignedModule = (await import("selfsigned")) as unknown as {
    default?: { generate?: SelfSignedGenerate };
    generate?: SelfSignedGenerate;
  };
  const generate = selfsignedModule.default?.generate ?? selfsignedModule.generate;
  if (typeof generate !== "function") {
    throw new Error("selfsigned module did not expose a `generate` function");
  }
  return generate(attrs, opts);
}
