-- API keys for management API authentication
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,       -- SHA-256 hash of the key
  key_prefix TEXT NOT NULL,            -- first 8 chars for identification (hf_sk_...)
  scopes TEXT NOT NULL DEFAULT '["admin"]',  -- JSON array: admin, read, write
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
