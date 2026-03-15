import { Hono } from "hono";
import type { Env, QueueMessage } from "./lib/types";
import { ApiError } from "./lib/errors";
import { handleWebhookIngress } from "./ingress/handler";
import { handleQueueBatch } from "./queue/consumer";
import { sourcesApi } from "./api/sources";
import { destinationsApi } from "./api/destinations";
import { subscriptionsApi } from "./api/subscriptions";
import { eventsApi } from "./api/events";

export { DeliveryManager } from "./delivery/manager";

const app = new Hono<{ Bindings: Env }>();

// --- Error handler ---
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toJSON(), err.statusCode as 400);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } }, 500);
});

// --- Health check ---
app.get("/health", (c) => c.json({ status: "ok" }));

// --- Webhook ingestion ---
app.post("/webhooks/:source_id", handleWebhookIngress);

// --- Management API ---
app.route("/api/v1/sources", sourcesApi);
app.route("/api/v1/destinations", destinationsApi);
app.route("/api/v1/subscriptions", subscriptionsApi);
app.route("/api/v1/events", eventsApi);

// --- Export ---
export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
