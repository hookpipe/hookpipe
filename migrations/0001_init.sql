-- Sources: webhook senders (e.g., Stripe, GitHub)
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  verification_type TEXT,          -- 'hmac-sha256', 'hmac-sha1', etc.
  verification_secret TEXT,        -- shared secret for signature verification
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Destinations: target URLs to forward webhooks to
CREATE TABLE destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  max_retries INTEGER NOT NULL DEFAULT 5,
  backoff_base_ms INTEGER NOT NULL DEFAULT 30000,
  backoff_max_ms INTEGER NOT NULL DEFAULT 86400000,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Subscriptions: connect sources to destinations with optional event type filters
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  event_types TEXT NOT NULL DEFAULT '["*"]',  -- JSON array of event type patterns
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(source_id, destination_id)
);

-- Events: received webhook payloads
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  event_type TEXT,
  idempotency_key TEXT,
  payload_r2_key TEXT,             -- R2 object key for archived payload
  headers TEXT,                    -- JSON object of relevant headers
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Deliveries: log of each delivery attempt
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, success, failed, dlq
  attempt INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  latency_ms INTEGER,
  response_body TEXT,              -- first 1KB of response
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Indexes
CREATE INDEX idx_events_source ON events(source_id, received_at);
CREATE INDEX idx_events_idempotency ON events(idempotency_key);
CREATE INDEX idx_deliveries_event ON deliveries(event_id);
CREATE INDEX idx_deliveries_destination ON deliveries(destination_id, status);
CREATE INDEX idx_subscriptions_source ON subscriptions(source_id);
