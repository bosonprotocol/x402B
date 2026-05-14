import { createWebhookSink } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const { app } = createWebhookSink();

app.listen(port, () => {
  console.log(`[webhook-sink] listening on :${port}`);
});
