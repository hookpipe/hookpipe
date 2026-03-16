import { Hono } from "hono";
import type { Env, QueueMessage } from "./lib/types";
import { ApiError } from "./lib/errors";
import { ValidationError } from "./lib/validation";
import { authMiddleware } from "./auth/middleware";
import { rateLimitMiddleware } from "./lib/rate-limit";
import { handleWebhookIngress } from "./ingress/handler";
import { handleQueueBatch } from "./queue/consumer";
import { bootstrapApi } from "./api/bootstrap";
import { sourcesApi } from "./api/sources";
import { destinationsApi } from "./api/destinations";
import { subscriptionsApi } from "./api/subscriptions";
import { eventsApi } from "./api/events";
import { keysApi } from "./api/keys";
import { transferApi } from "./api/transfer";
import { createDb } from "./db/queries";
import { listApiKeys } from "./auth/keys";

export { DeliveryManager } from "./delivery/manager";
export { RateLimiter } from "./lib/rate-limiter-do";

const app = new Hono<{ Bindings: Env }>();

// --- Error handler ---
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toJSON(), err.statusCode as 400);
  }
  if (err instanceof ValidationError) {
    return c.json({
      error: {
        message: err.message,
        code: "VALIDATION_ERROR",
        ...(err.issues ? { details: err.issues } : {}),
      },
    }, 400);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } }, 500);
});

// --- Health check (public) — includes setup_required flag ---
app.get("/health", async (c) => {
  let setupRequired = false;
  if (!c.env.API_TOKEN) {
    try {
      const db = createDb(c.env.DB);
      const keys = await listApiKeys(db);
      setupRequired = keys.length === 0;
    } catch {
      // D1 not available — setup is definitely required
      setupRequired = true;
    }
  }
  return c.json({ status: "ok", setup_required: setupRequired });
});

// --- Webhook ingestion (public, rate-limited) ---
app.use("/webhooks/:source_id", rateLimitMiddleware());
app.post("/webhooks/:source_id", handleWebhookIngress);

// --- Bootstrap (no auth — self-locking after first use) ---
app.route("/api/v1", bootstrapApi);

// --- Management API (authenticated) ---
app.use("/api/v1/*", authMiddleware());
app.route("/api/v1/sources", sourcesApi);
app.route("/api/v1/destinations", destinationsApi);
app.route("/api/v1/subscriptions", subscriptionsApi);
app.route("/api/v1/events", eventsApi);
app.route("/api/v1/keys", keysApi);
app.route("/api/v1", transferApi);

// --- Worker export ---
export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
