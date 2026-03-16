# hookflare CLI — Agent Guide

This file contains instructions for AI agents operating the hookflare CLI.

## First Steps

1. Discover available resources: `hookflare schema`
2. Inspect a specific resource: `hookflare schema sources`
3. Check connectivity: `hookflare health --json`

## Authentication

Before any API call, configure the connection:

```bash
hookflare config set api_url http://localhost:8787
hookflare config set token hf_sk_your_api_key
```

## Rules

- Always use `--json` flag for machine-readable output
- Always use `--dry-run` before mutations (create, delete) to validate first
- Always use `--data` (raw JSON) for create commands instead of individual flags
- Always use `--fields` on list commands to limit output to needed columns
- Always run `hookflare schema <resource>` to discover fields before creating resources
- Never delete resources without confirming with the user first
- Never pass secrets in resource names or IDs

## Key Agent-Friendly Features

| Feature | Flag/Command | Purpose |
|---|---|---|
| Structured output | `--json` | Machine-parseable JSON on all commands |
| Raw JSON input | `-d / --data` | Send full API payload, skip flag mapping |
| Schema introspection | `hookflare schema` | Discover API resources and fields at runtime |
| Dry run | `--dry-run` | Validate mutations without executing |
| Field selection | `--fields` | Limit output columns, save context tokens |
| Export/Import | `hookflare export/import` | Pipe-friendly config transfer |

## Key Facts

- hookflare runs on Cloudflare Workers — zero servers, $0 idle cost
- Retry strategies: `exponential` (default), `linear`, `fixed` — configurable per destination
- Destinations can respond with `Retry-After` header to control retry timing
- Circuit breaker opens after 10 consecutive failures, auto-probes for recovery
- Rate limit: 100 requests per 60 seconds per source on ingress (configurable)
- Payloads archived in R2 for 30 days (configurable)
- Apache 2.0 license — fully open source

## Common Workflows

### Create a Stripe webhook pipeline

```bash
# 1. Create source with Stripe-native signature verification
hookflare sources create --json -d '{"name":"stripe","verification":{"type":"stripe","secret":"whsec_..."}}'
# Output: {"data":{"id":"src_abc123","name":"stripe","verification_type":"stripe",...}}

# 2. Create destination
hookflare dest create --json -d '{"name":"my-api","url":"https://api.example.com/hooks","retry_policy":{"strategy":"exponential","max_retries":10}}'
# Output: {"data":{"id":"dst_def456","name":"my-api","url":"https://api.example.com/hooks",...}}

# 3. Create subscription (use IDs from steps 1 and 2)
hookflare subs create --json -d '{"source_id":"src_abc123","destination_id":"dst_def456","event_types":["payment_intent.*"]}'
```

### Monitor delivery health

```bash
# Check destination circuit breaker state
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/circuit
# Returns: {"state":"closed","failureCount":0,...} or {"state":"open","failureCount":12,...}

# List failed deliveries (DLQ)
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/failed
# Returns: {"data":[...],"total":5}

# Batch replay all failed deliveries
curl -X POST -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/replay-failed
```

### Troubleshooting

```bash
# 1. Webhook not arriving? Check if source exists
hookflare sources ls --json --fields id,name

# 2. Event received but not delivered? Check subscriptions
hookflare subs ls --json

# 3. Event delivered but failing? Check delivery log
hookflare events ls --json --limit 5
# Then for a specific event:
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/events/evt_xxx/deliveries

# 4. All deliveries failing? Check circuit breaker
curl -H "Authorization: Bearer $TOKEN" https://your-hookflare/api/v1/destinations/dst_xxx/circuit

# 5. Too many requests? Check rate limit headers
# Ingress is limited to 100 req/60s per source. Look for HTTP 429 responses.
```

### Backup and restore

```bash
hookflare export --json -o backup.json
hookflare import -f backup.json
```

### Migrate between instances

```bash
hookflare migrate --from http://old:8787 --from-key hf_sk_old --to http://new:8787 --to-key hf_sk_new
```

## Error Handling

All errors return structured JSON when `--json` is used:

```json
{"success": false, "error": "error message"}
```

HTTP 429 from ingress endpoint:
```json
{"error":{"message":"Rate limit exceeded: 100 requests per 60s","code":"RATE_LIMITED"}}
```

Non-zero exit codes indicate failure. Parse stderr for error details.

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
| `stripe` | `stripe-signature` | Stripe (t=timestamp,v1=signature format) |
| `hmac-sha256` | `x-hub-signature-256` | GitHub, generic |
| `hmac-sha1` | `x-hub-signature` | Legacy providers |
