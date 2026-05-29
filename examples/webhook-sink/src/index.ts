import { startWebhookSink } from "./app.js";

const rawPort = process.env.PORT;
const parsedPort = rawPort === undefined ? 4000 : Number.parseInt(rawPort, 10);
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error(`[webhook-sink] invalid PORT: ${rawPort}`);
}
// HTTPS only when explicitly opted in (`TLS=1`); the compose service
// keeps its plain-HTTP listener for manual smoke testing.
const tls = process.env.TLS === "1";

function toDisplayUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "0.0.0.0") {
      parsedUrl.hostname = "localhost";
    }
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

startWebhookSink({ port: parsedPort, host: "0.0.0.0", tls })
  .then(({ url }) => {
    console.log(`[webhook-sink] listening on ${toDisplayUrl(url)}`);
  })
  .catch((err: unknown) => {
    console.error("[webhook-sink] failed to start:", err);
    process.exitCode = 1;
  });
