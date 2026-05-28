import http from "node:http";
import https from "node:https";

import express, { type Express } from "express";

import { generateSelfSignedCert } from "./_selfsigned.js";

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

/** A listening webhook sink: its base URL, the sink handle, and a stopper. */
export interface RunningWebhookSink {
  /** Base URL (`http(s)://<host>:<port>`); the capture route is `POST <url>/hook`. */
  url: string;
  sink: WebhookSink;
  /** Stop the server. */
  close: () => Promise<void>;
}

export interface StartWebhookSinkOptions {
  /** Port to bind; `0` (default) picks a free OS port. */
  port?: number;
  /** Bind host. Defaults to `127.0.0.1`. */
  host?: string;
  /**
   * Serve over HTTPS with a freshly generated self-signed certificate.
   * The `webhook` fulfillment channel requires the buyer's callback URL
   * to be `https://`, so the e2e suite drives A6 against a TLS sink. The
   * cert is self-signed, so clients must opt out of verification
   * (`rejectUnauthorized: false`) — acceptable for a local test sink.
   */
  tls?: boolean;
}

/**
 * Start the sink on an HTTP or (self-signed) HTTPS listener and return
 * its URL + handle. Generating the cert at runtime keeps a private key
 * out of the repo.
 */
export async function startWebhookSink(
  options: StartWebhookSinkOptions = {},
): Promise<RunningWebhookSink> {
  const sink = createWebhookSink();
  const host = options.host ?? "127.0.0.1";

  let server: http.Server | https.Server;
  let scheme: "http" | "https";
  if (options.tls === true) {
    const pems = await generateSelfSignedCert([{ name: "commonName", value: "localhost" }], {
      days: 36500,
      keySize: 2048,
      algorithm: "sha256",
    });
    server = https.createServer({ key: pems.private, cert: pems.cert }, sink.app);
    scheme = "https";
  } else {
    server = http.createServer(sink.app);
    scheme = "http";
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);

  return {
    url: `${scheme}://${host}:${port}`,
    sink,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
