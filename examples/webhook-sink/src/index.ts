import { createWebhookSink } from "./app.js";

const rawPort = process.env.PORT;
const parsedPort = rawPort === undefined ? 4000 : Number.parseInt(rawPort, 10);
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error(`[webhook-sink] invalid PORT: ${rawPort}`);
}
const port = parsedPort;
const { app } = createWebhookSink();

app.listen(port, () => {
  console.log(`[webhook-sink] listening on :${port}`);
});
