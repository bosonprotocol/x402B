import type { FacilitatorConfig } from "@bosonprotocol/x402-facilitator";
import { mountFacilitator } from "@bosonprotocol/x402-facilitator-express";
import express, { type Express } from "express";

export function createFacilitatorApp(config: FacilitatorConfig): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(mountFacilitator(config));

  return app;
}
