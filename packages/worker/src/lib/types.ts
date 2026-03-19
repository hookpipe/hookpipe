export type {
  Source,
  Destination,
  Subscription,
  Event,
  Delivery,
} from "@hookpipe/shared";

// Worker-specific: Cloudflare bindings
export interface Env {
  DB: D1Database;
  API_TOKEN?: string; // Simple mode: single env var token
  DLQ_NOTIFICATION_URL?: string; // Webhook URL for DLQ alerts
  WEBHOOK_QUEUE: Queue<QueueMessage>;
  IDEMPOTENCY_KV: KVNamespace;
  PAYLOAD_BUCKET: R2Bucket;
  DELIVERY_DO: DurableObjectNamespace;
  RATE_LIMITER_DO: DurableObjectNamespace;
  RETRY_MAX_ATTEMPTS: string;
  RETRY_BACKOFF_BASE_MS: string;
  RETRY_BACKOFF_MAX_MS: string;
  IDEMPOTENCY_TTL_S: string;
  PAYLOAD_ARCHIVE_DAYS: string;
  DELIVERY_TIMEOUT_MS: string;
}

// Worker-specific: Queue message payload
export interface QueueMessage {
  eventId: string;
  sourceId: string;
  eventType: string | null;
  payloadR2Key: string;      // R2 key where payload is archived (written by ingress)
  headers: Record<string, string>;
  idempotencyKey: string | null;
  receivedAt: string;
}

// Worker-specific: Delivery DO message
export interface DeliveryTask {
  deliveryId: string;
  eventId: string;
  destinationId: string;
  destinationUrl: string;
  payloadR2Key: string;
  headers: Record<string, string>;
  attempt: number;
  maxRetries: number;
  timeoutMs: number;
  retryStrategy?: "exponential" | "linear" | "fixed";
  retryIntervalMs?: number;
  retryMaxIntervalMs?: number;
  retryOnStatus?: string; // JSON array e.g. '["5xx","429"]'
}
