-- Consumer sessions for agent event consumption.
-- A consumer tracks a cursor (last_acked_at) so agents can resume
-- from where they left off after restart.

CREATE TABLE consumers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  event_types TEXT NOT NULL DEFAULT '["*"]',
  last_acked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
