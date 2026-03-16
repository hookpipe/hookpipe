# hookflare CLI — Agent Guide

This file contains instructions for AI agents operating the hookflare CLI.

## First Steps

1. Discover available providers: `hookflare providers ls`
2. Inspect a provider's events: `hookflare providers describe stripe --json`
3. Check connectivity: `hookflare health --json`

## Authentication

```bash
hookflare config set api_url http://localhost:8787
hookflare config set token hf_sk_your_api_key
```

## Rules

- Always use `--json` flag for machine-readable output
- Always use `--dry-run` before mutations to validate first
- Always use `hookflare providers describe <name>` to discover events before connecting
- Always use `hookflare connect` for simple setups (one source → one destination)
- Use individual commands (`sources create`, `dest create`, `subs create`) for fan-out or advanced config
- Never delete resources without confirming with the user first

## Key Facts

- hookflare runs on Cloudflare Workers — zero servers, $0 idle cost
- Built-in providers: Stripe, GitHub, Slack, Shopify, Vercel
- Retry strategies: `exponential` (default), `linear`, `fixed` — configurable per destination
- Destinations can respond with `Retry-After` header to control retry timing
- Circuit breaker opens after 10 consecutive failures, auto-probes for recovery
- Rate limit: 100 requests per 60 seconds per source on ingress
- Payloads archived in R2 for 30 days (configurable)
- Apache 2.0 license

## CLI Reference

### Local development tunnel

```bash
hookflare dev --port <n> [--provider <name>] [--secret <s>] [--no-verify]
```

Creates a secure tunnel to localhost via Cloudflare Quick Tunnel. No port forwarding, no IP exposure. Verifies provider signatures locally before forwarding. Auto-downloads `cloudflared` if not installed.

```bash
# Stripe with signature verification
hookflare dev --port 3000 --provider stripe --secret whsec_xxx

# Any webhook, no verification
hookflare dev --port 3000
```

### One-shot setup

```bash
hookflare connect <provider> --secret <s> --to <url> [--events <filter>] [--name <n>] [--json] [--dry-run]
```

Creates source + destination + subscription in one command. Output includes the webhook URL to register with the provider.

### Provider discovery

```bash
hookflare providers ls [--json]
hookflare providers describe <name> [--json]
```

### Individual resources (advanced)

```bash
hookflare sources create -d '{...}' [--json] [--dry-run]
hookflare sources ls [--json] [--fields <f>]
hookflare dest create -d '{...}' [--json] [--dry-run]
hookflare dest ls [--json] [--fields <f>]
hookflare subs create -d '{...}' [--json] [--dry-run]
hookflare subs ls [--json]
```

### Events and delivery

```bash
hookflare events ls [--json] [--source <id>] [--limit <n>]
hookflare events get <id> [--json]
hookflare events replay <id>
hookflare tail [--json] [--source <id>]    # real-time event stream
```

### DLQ notifications

Set `DLQ_NOTIFICATION_URL` environment variable to receive a webhook when deliveries permanently fail:

```bash
wrangler secret put DLQ_NOTIFICATION_URL
# Enter: https://hooks.slack.com/services/xxx (or any webhook URL)
```

Notification payload:
```json
{
  "type": "delivery.dlq",
  "delivery_id": "dlv_xxx",
  "event_id": "evt_xxx",
  "destination_id": "dst_xxx",
  "destination_url": "https://...",
  "attempt": 10,
  "last_status_code": 500,
  "last_response": "Internal Server Error",
  "timestamp": "2026-03-16T..."
}
```

### System

```bash
hookflare health [--json]
hookflare schema <resource>
hookflare export [-o <file>]
hookflare import [-f <file>]
hookflare migrate --from <url> --to <url>
```

## Common Workflows

### Local development with real webhooks

```bash
# Start tunnel — webhooks from Stripe reach your localhost securely
hookflare dev --port 3000 --provider stripe --secret whsec_xxx

# Output:
# ✓ Tunnel established
# ✓ Stripe signature verification: enabled
#
#   Webhook URL:  https://random-words.trycloudflare.com   ← paste into Stripe Dashboard
#   Forwarding:   → http://localhost:3000
#
# [12:00:01] payment_intent.succeeded  ✓ sig  → localhost:3000 (200, 45ms)
```

No port forwarding, no IP exposure, no Cloudflare account needed. `cloudflared` is auto-downloaded if not present.

### Connect Stripe in one command

```bash
hookflare connect stripe --secret whsec_xxx --to https://api.example.com/hooks --events "payment_intent.*" --json
# Output includes:
# - source.id (src_abc123)
# - source.webhook_url (https://your-hookflare.workers.dev/webhooks/src_abc123)
# - destination.id (dst_def456)
# - subscription.id (sub_ghi789)
# - next_steps.instruction ("Add the webhook_url in your Stripe Dashboard")
```

### Fan-out: Stripe → API + Slack

```bash
# Step 1: Create Stripe source
hookflare sources create --json -d '{"name":"stripe","provider":"stripe","verification":{"type":"stripe","secret":"whsec_xxx"}}'
# → src_abc123

# Step 2: Create two destinations
hookflare dest create --json -d '{"name":"my-api","url":"https://api.example.com/hooks"}'
# → dst_api
hookflare dest create --json -d '{"name":"slack-alerts","url":"https://hooks.slack.com/services/xxx"}'
# → dst_slack

# Step 3: Create two subscriptions
hookflare subs create --json -d '{"source_id":"src_abc123","destination_id":"dst_api","event_types":["*"]}'
hookflare subs create --json -d '{"source_id":"src_abc123","destination_id":"dst_slack","event_types":["payment_intent.payment_failed"]}'
```

### Multiple environments (same provider, different secrets)

```bash
hookflare connect stripe --secret whsec_prod --to https://api.myapp.com/hooks --name stripe-prod
hookflare connect stripe --secret whsec_stg --to https://staging.myapp.com/hooks --name stripe-staging
```

### Monitor delivery health

```bash
# Circuit breaker state
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/circuit

# Failed deliveries (DLQ)
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/failed

# Batch replay all failed
curl -X POST -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/replay-failed
```

### Troubleshooting

```bash
# 1. Check sources exist
hookflare sources ls --json --fields id,name,provider

# 2. Check subscriptions
hookflare subs ls --json

# 3. Check recent events
hookflare events ls --json --limit 5

# 4. Check circuit breaker (if deliveries stopped)
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/circuit

# 5. Rate limited? Look for HTTP 429 on ingress
```

### Backup and restore

```bash
hookflare export -o backup.json
hookflare import -f backup.json
```

### Migrate between instances

```bash
hookflare migrate --from http://old:8787 --from-key hf_sk_old --to http://new:8787 --to-key hf_sk_new
```

## Error Handling

### Error response schema

API errors (when using `--json`):

```json
{
  "error": {
    "message": "Human-readable description",
    "code": "MACHINE_READABLE_CODE",
    "details": []
  }
}
```

CLI errors (stderr):

```json
{"success": false, "error": "error message"}
```

### Exit codes

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (API error, network failure, invalid input) |

### Error codes

| HTTP | Code | Meaning | Agent action |
|---|---|---|---|
| 400 | `BAD_REQUEST` | Invalid request | Fix input, do not retry |
| 400 | `VALIDATION_ERROR` | Zod schema validation failed (`.details` has field-level errors) | Fix the specific field in `.details` |
| 401 | `UNAUTHORIZED` | Invalid or missing API key | Check token in config |
| 401 | `SETUP_REQUIRED` | No auth configured — call `POST /api/v1/bootstrap` or `hookflare init` | Run `hookflare init` |
| 403 | `BOOTSTRAP_COMPLETED` | Bootstrap already done — instance has an admin key | Use existing key or set `API_TOKEN` env var |
| 403 | `BOOTSTRAP_UNNECESSARY` | `API_TOKEN` env var is set — bootstrap not needed | Use the env var token |
| 404 | `NOT_FOUND` | Resource does not exist | Check the ID |
| 404 | `SOURCE_NOT_FOUND` | Webhook source ID invalid (on ingress endpoint) | Verify source exists |
| 409 | `BOOTSTRAP_CONFLICT` | Race condition during bootstrap | Use `API_TOKEN` env var to recover |
| 413 | `PAYLOAD_TOO_LARGE` | Webhook body exceeds 256KB | Reduce payload size |
| 429 | `RATE_LIMITED` | Per-source rate limit exceeded | Wait for `Retry-After` header value |
| 500 | `INTERNAL_ERROR` | Unexpected server error | Retry once, then report |

### Idempotency guarantees

| Command | Safe to retry? | Behavior on repeat |
|---|---|---|
| `hookflare init` | ✅ Yes | No-op if already bootstrapped |
| `hookflare connect <provider>` | ⚠️ Partial | Creates duplicate if source name differs; skips if same name exists |
| `hookflare sources create` | ❌ No | Creates duplicate (unique name constraint may reject) |
| `hookflare dest create` | ❌ No | Creates duplicate (unique name constraint may reject) |
| `hookflare subs create` | ❌ No | Unique(source_id, destination_id) constraint may reject |
| `hookflare events replay` | ✅ Yes | Re-enqueues the event; delivery is deduplicated by destination |
| `hookflare export` | ✅ Yes | Read-only |
| `hookflare import` | ✅ Yes | Skips existing resources by name |

## Resource ID Format

- Sources: `src_<hex>`
- Destinations: `dst_<hex>`
- Subscriptions: `sub_<hex>`
- Events: `evt_<hex>`
- Deliveries: `dlv_<hex>`
- API Keys: `key_<hex>`

## Verification Types

| Type | Header | Provider |
|---|---|---|
| `stripe` | `stripe-signature` | Stripe (t=timestamp,v1=signature) |
| `github` | `x-hub-signature-256` | GitHub |
| `slack` | `x-slack-signature` | Slack (v0:timestamp:body) |
| `shopify` | `x-shopify-hmac-sha256` | Shopify (Base64) |
| `vercel` | `x-vercel-signature` | Vercel |
| `hmac-sha256` | configurable | Generic HMAC-SHA256 |
| `hmac-sha1` | configurable | Legacy providers |
