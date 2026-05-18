import { pathToFileURL } from "node:url";
import { createResourceServerApp } from "./app.js";
import { readEnv } from "./config.js";

// The convenience handlers settle on-chain *before* they verify state
// through `ExchangeReader`, so booting with a stub reader (the kind
// that returns `null`) would silently accept a valid `X-PAYMENT`,
// charge the buyer on-chain, then return STATE_VERIFY_EXCHANGE_NOT_FOUND
// with no remedy. There's no built-in subgraph/RPC reader in this
// example yet — fork the binary entry point (this file) and wire one
// up before running the host in any context that takes real funds.
// See the "Wire up `ExchangeReader` before running the binary" section
// in `examples/resource-server/README.md`.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  throw new Error(
    "[resource-server] no ExchangeReader is configured. The binary refuses to start because the commit/redeem/dispute handlers would settle on-chain before any state verification, charging buyers without delivering the resource. Fork `examples/resource-server/src/index.ts` to construct a real reader (subgraph-backed via `coreSDK.getExchangeById` or RPC-backed via `publicClient.readContract`) and pass it to `createResourceServerApp(env, { exchangeReader })`. See the README for details.",
  );
}

// Reference assembly for forks — once `exchangeReader` is wired in,
// replace the throw above with:
//
//   const env = readEnv();
//   const { app, seller } = createResourceServerApp(env, { exchangeReader });
//   app.listen(env.port, () => {
//     console.log(
//       `[resource-server] listening on :${env.port} (chain ${env.chainId}, seller ${seller.address}, asset ${env.assetAddress})`,
//     );
//   });
//
// `createResourceServerApp` and `readEnv` are re-exported so the fork
// only needs to add the reader.
export { createResourceServerApp, readEnv };
