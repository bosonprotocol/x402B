import { createFacilitatorApp } from "./app.js";
import { buildFacilitatorConfig, readEnv } from "./config.js";

const env = readEnv();
const config = buildFacilitatorConfig(env);
const app = createFacilitatorApp(config);

app.listen(env.port, () => {
  console.log(
    `[facilitator-http] listening on :${env.port} (chain ${env.chainId}, escrow ${env.escrowAddress})`,
  );
});
