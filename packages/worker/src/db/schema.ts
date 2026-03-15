import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamp = () =>
  text().notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);

// --- Sources ---

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  verification_type: text("verification_type"),
  verification_secret: text("verification_secret"),
  created_at: timestamp(),
  updated_at: timestamp(),
});

// --- Destinations ---

export const destinations = sqliteTable("destinations", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  url: text("url").notNull(),
  timeout_ms: integer("timeout_ms").notNull().default(30000),
  max_retries: integer("max_retries").notNull().default(5),
  backoff_base_ms: integer("backoff_base_ms").notNull().default(30000),
  backoff_max_ms: integer("backoff_max_ms").notNull().default(86400000),
  created_at: timestamp(),
  updated_at: timestamp(),
});

// --- Subscriptions ---

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  source_id: text("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  destination_id: text("destination_id")
    .notNull()
    .references(() => destinations.id, { onDelete: "cascade" }),
  event_types: text("event_types").notNull().default('["*"]'),
  enabled: integer("enabled").notNull().default(1),
  created_at: timestamp(),
});

// --- Events ---

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  source_id: text("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  event_type: text("event_type"),
  idempotency_key: text("idempotency_key"),
  payload_r2_key: text("payload_r2_key"),
  headers: text("headers"),
  received_at: timestamp(),
});

// --- API Keys ---

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  key_hash: text("key_hash").notNull().unique(),
  key_prefix: text("key_prefix").notNull(),
  scopes: text("scopes").notNull().default('["admin"]'),
  last_used_at: text("last_used_at"),
  expires_at: text("expires_at"),
  revoked_at: text("revoked_at"),
  created_at: timestamp(),
});

// --- Deliveries ---

export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  event_id: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  destination_id: text("destination_id")
    .notNull()
    .references(() => destinations.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "success", "failed", "dlq"] })
    .notNull()
    .default("pending"),
  attempt: integer("attempt").notNull().default(0),
  status_code: integer("status_code"),
  latency_ms: integer("latency_ms"),
  response_body: text("response_body"),
  next_retry_at: text("next_retry_at"),
  created_at: timestamp(),
  updated_at: timestamp(),
});
