// Outer HTML shell that wraps the React app bundle. `src/build.ts` reads
// this template, splices the esbuild-produced `<script>` + `<style>`
// blocks into the marked locations, and writes the result as the
// `EVM_ESCROW_PAYWALL_TEMPLATE` string constant in `src/gen/template.ts`.
//
// The `<!--CSS-->` and `<!--JS-->` placeholders are what the build script
// looks for. Keep them on their own lines so the substitution stays
// readable in `git diff` of the generated template.

export const BASE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment required — x402B</title>
  <style><!--CSS--></style>
</head>
<body>
  <div id="root">
    <noscript>
      This page requires JavaScript to render the payment flow. The
      server returned a <code>402 Payment Required</code> response with
      an <code>escrow</code> scheme PaymentRequirements body — pay
      programmatically with
      <a href="https://github.com/bosonprotocol/x402B">@bosonprotocol/x402-client-fetch</a>
      or enable JavaScript.
    </noscript>
  </div>
  <script><!--JS--></script>
</body>
</html>
`;
