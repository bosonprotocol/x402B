import express, { type Express } from "express";

export interface WebhookSink {
  app: Express;
  /** Clear the in-memory store. Tests call this between cases. */
  clear: () => void;
  /** Read-only snapshot of bodies received so far. */
  snapshot: () => readonly unknown[];
}

export function createWebhookSink(): WebhookSink {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const received: unknown[] = [];

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/hook", (req, res) => {
    received.push(req.body);
    res.status(204).end();
  });

  app.get("/received", (_req, res) => {
    res.json(received);
  });

  app.delete("/received", (_req, res) => {
    received.length = 0;
    res.status(204).end();
  });

  return {
    app,
    clear: () => {
      received.length = 0;
    },
    snapshot: () => received.slice(),
  };
}
