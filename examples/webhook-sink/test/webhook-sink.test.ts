import supertest from "supertest";
import { describe, expect, it, beforeEach } from "vitest";

import { createWebhookSink } from "../src/app.js";

describe("webhook-sink", () => {
  let sink = createWebhookSink();
  let agent = supertest(sink.app);

  beforeEach(() => {
    sink = createWebhookSink();
    agent = supertest(sink.app);
  });

  it("GET /health returns ok", async () => {
    const res = await agent.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /hook stores the body and GET /received returns it", async () => {
    const payload = { exchangeId: "42", action: "boson-redeem" };

    const post = await agent.post("/hook").send(payload);
    expect(post.status).toBe(204);

    const get = await agent.get("/received");
    expect(get.status).toBe(200);
    expect(get.body).toEqual([payload]);
  });

  it("multiple POSTs accumulate in order", async () => {
    await agent.post("/hook").send({ n: 1 });
    await agent.post("/hook").send({ n: 2 });
    await agent.post("/hook").send({ n: 3 });

    const res = await agent.get("/received");
    expect(res.body).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("DELETE /received empties the store", async () => {
    await agent.post("/hook").send({ n: 1 });
    expect(sink.snapshot()).toHaveLength(1);

    const del = await agent.delete("/received");
    expect(del.status).toBe(204);

    const res = await agent.get("/received");
    expect(res.body).toEqual([]);
    expect(sink.snapshot()).toEqual([]);
  });
});
