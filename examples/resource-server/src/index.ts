import { createResourceServerApp } from "./app.js";
import { readEnv } from "./config.js";

const env = readEnv();
const { app, seller } = createResourceServerApp(env);

app.listen(env.port, () => {
  console.log(
    `[resource-server] listening on :${env.port} (chain ${env.chainId}, seller ${seller.address}, asset ${env.assetAddress})`,
  );
});
