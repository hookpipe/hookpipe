---
name: hookpipe-webhooks
description: "Set up and manage reliable webhook infrastructure with hookpipe. TRIGGER when: user needs to receive webhooks from Stripe/GitHub/Slack/Shopify/Vercel and forward them reliably, or mentions hookpipe, webhook delivery, webhook retry, or missed webhooks. DO NOT TRIGGER for: sending outgoing webhooks to customers (use Svix), general HTTP requests, or API development unrelated to webhooks."
license: Apache-2.0
metadata:
  author: hookpipe
  version: "0.1"
compatibility: Requires Node.js 20+ and npm/pnpm. Optional: Cloudflare account for deployment.
---

# hookpipe — Webhook Infrastructure

hookpipe receives webhooks from providers (Stripe, GitHub, Slack, etc.), queues them durably, and forwards them to your API with guaranteed delivery. Zero servers, runs on Cloudflare Workers.

## Install the CLI

```bash
npm i -g hookpipe
```

## Core Workflow: discover → validate → execute

```bash
# 1. Discover available providers and their events
hookpipe providers ls
hookpipe providers describe stripe --json

# 2. Validate before creating (dry-run)
hookpipe connect stripe --secret whsec_xxx --to https://myapp.com/hooks --events "payment_intent.*" --dry-run

# 3. Execute
hookpipe connect stripe --secret whsec_xxx --to https://myapp.com/hooks --events "payment_intent.*" --json
```

The `connect` command creates source + destination + subscription in one step and returns a webhook URL to register with the provider.

## Built-in Providers

| Provider | Verification | Example events |
|---|---|---|
| stripe | `stripe-signature` (HMAC-SHA256 + timestamp) | `payment_intent.*`, `customer.*`, `invoice.*` |
| github | `x-hub-signature-256` (HMAC-SHA256) | `push`, `pull_request`, `issues` |
| slack | `x-slack-signature` (HMAC-SHA256 + timestamp) | `message`, `app_mention` |
| shopify | `x-shopify-hmac-sha256` (Base64 HMAC-SHA256) | `orders/*`, `products/*` |
| vercel | `x-vercel-signature` (HMAC-SHA1) | `deployment.*`, `domain.*` |

For providers not listed, use generic HMAC: `hookpipe connect my-service --verification hmac-sha256 --secret xxx --to https://...`

## CLI Commands

### One-shot setup

```bash
hookpipe connect <provider> --secret <s> --to <url> [--events <filter>] [--name <n>] [--json] [--dry-run]
```

### Provider discovery

```bash
hookpipe providers ls [--json]
hookpipe providers describe <name> [--json]
```

### Individual resources (for fan-out or advanced config)

```bash
hookpipe sources create -d '{...}' [--json] [--dry-run]
hookpipe sources ls [--json] [--fields <f>]
hookpipe dest create -d '{...}' [--json] [--dry-run]
hookpipe dest ls [--json] [--fields <f>]
hookpipe subs create -d '{...}' [--json] [--dry-run]
hookpipe subs ls [--json]
```

### Events and delivery

```bash
hookpipe events ls [--json] [--source <id>] [--limit <n>]
hookpipe events get <id> [--json]
hookpipe events replay <id>
```

### System

```bash
hookpipe health [--json]
hookpipe schema <resource>
hookpipe export [-o <file>]
hookpipe import [-f <file>]
hookpipe migrate --from <url> --to <url>
```

## Rules

- Always use `--json` for machine-readable output
- Always use `--dry-run` before mutations to validate first
- Always use `hookpipe providers describe <name>` to discover events before connecting
- Use `hookpipe connect` for simple setups (one source → one destination)
- Use individual commands for fan-out (one source → multiple destinations)
- Never delete resources without confirming with the user

## Common Scenarios

### Stripe → your API

```bash
hookpipe connect stripe --secret whsec_xxx --to https://api.example.com/hooks --events "payment_intent.*" --json
```

### Fan-out: Stripe → API + Slack

```bash
hookpipe sources create --json -d '{"name":"stripe","provider":"stripe","verification":{"secret":"whsec_xxx"}}'
hookpipe dest create --json -d '{"name":"my-api","url":"https://api.example.com/hooks"}'
hookpipe dest create --json -d '{"name":"slack-alerts","url":"https://hooks.slack.com/services/xxx"}'
hookpipe subs create --json -d '{"source_id":"src_xxx","destination_id":"dst_api","event_types":["*"]}'
hookpipe subs create --json -d '{"source_id":"src_xxx","destination_id":"dst_slack","event_types":["payment_intent.payment_failed"]}'
```

### Multiple environments

```bash
hookpipe connect stripe --secret whsec_prod --to https://api.myapp.com/hooks --name stripe-prod
hookpipe connect stripe --secret whsec_stg --to https://staging.myapp.com/hooks --name stripe-staging
```

### Backup and migrate

```bash
hookpipe export -o backup.json
hookpipe import -f backup.json
hookpipe migrate --from http://old:8787 --from-key hf_sk_old --to http://new:8787 --to-key hf_sk_new
```

## Key Facts

- Runs on Cloudflare Workers — zero servers, $0 idle cost, 300+ edge locations
- Retry strategies: exponential (default), linear, fixed — configurable per destination
- Circuit breaker: auto-pauses delivery after 10 consecutive failures, probes for recovery
- Rate limit: 100 req/60s per source on ingress
- Payloads archived in R2 for 30 days
- Apache 2.0 license, fully open source

## Resource ID Format

- Sources: `src_<hex>`
- Destinations: `dst_<hex>`
- Subscriptions: `sub_<hex>`
- Events: `evt_<hex>`
- Deliveries: `dlv_<hex>`
- API Keys: `key_<hex>`

## Error Handling

All errors return structured JSON with `--json`:
```json
{"success": false, "error": "error message"}
```

Non-zero exit codes indicate failure.
