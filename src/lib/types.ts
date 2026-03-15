// Cloudflare bindings
export interface Env {
  DB: D1Database;
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

// Queue message payload
export interface QueueMessage {
  eventId: string;
  sourceId: string;
  eventType: string | null;
  payloadR2Key: string;
  headers: Record<string, string>;
  receivedAt: string;
}

// Database row types
export interface Source {
  id: string;
  name: string;
  verification_type: string | null;
  verification_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface Destination {
  id: string;
  name: string;
  url: string;
  timeout_ms: number;
  max_retries: number;
  backoff_base_ms: number;
  backoff_max_ms: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  source_id: string;
  destination_id: string;
  event_types: string; // JSON array
  enabled: number;
  created_at: string;
}

export interface Event {
  id: string;
  source_id: string;
  event_type: string | null;
  idempotency_key: string | null;
  payload_r2_key: string | null;
  headers: string | null; // JSON object
  received_at: string;
}

export interface Delivery {
  id: string;
  event_id: string;
  destination_id: string;
  status: "pending" | "success" | "failed" | "dlq";
  attempt: number;
  status_code: number | null;
  latency_ms: number | null;
  response_body: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

// Delivery DO message
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
