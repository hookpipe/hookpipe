export type {
  Source,
  Destination,
  Subscription,
  Event,
  Delivery,
} from "@hookflare/shared";

// Worker-specific: Cloudflare bindings
export interface Env {
  DB: D1Database;
  API_TOKEN?: string; // Simple mode: single env var token
  WEBHOOK_QUEUE: Queue<QueueMessage>;
  IDEMPOTENCY_KV: KVNamespace;
  PAYLOAD_BUCKET: R2Bucket;
  DELIVERY_DO: DurableObjectNamespace;
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
  payloadR2Key: string;
  headers: Record<string, string>;
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
  backoffBaseMs: number;
  backoffMaxMs: number;
}
