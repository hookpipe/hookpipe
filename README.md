# hookpipe

**Never miss a webhook.** Free, open-source, deploys to Cloudflare in 30 seconds.

[![CI](https://github.com/hookpipe/hookpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/hookpipe/hookpipe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hookpipe)](https://www.npmjs.com/package/hookpipe)
[![npm downloads](https://img.shields.io/npm/dm/hookpipe)](https://www.npmjs.com/package/hookpipe)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

> **Status: Alpha** — Built by a solo developer in TypeScript. Fully functional and tested, not yet proven in production. See [Status](#status) for details.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hookpipe/hookpipe)

## Why hookpipe?

Webhooks are deceptively simple — until they aren't. Providers send them once and move on. If your server is down, slow, or returns an error, that event is gone. hookpipe sits between webhook sources and your application to make sure **nothing gets lost**.

- **Built-in providers** — Stripe, GitHub, Slack, Shopify, Vercel out of the box. Each provider includes signature verification, typed event catalogs, and setup instructions. Community-extensible via [`defineProvider()`](packages/providers/DESIGN.md) — one file, three fields.
- **Never miss a webhook** — Incoming payloads are immediately queued at the edge before your backend even processes them.
- **Reliable delivery** — Automatic retries with exponential backoff, configurable per destination. Circuit breaker auto-pauses unhealthy destinations.
- **Zero infrastructure** — No Docker, PostgreSQL, or Redis. Runs entirely on Cloudflare Workers.
- **Free to start** — Runs on Cloudflare's free tier (~50K events/day). No VM costs, $0 idle.
- **Agent-optimized** — CLI with `--json`, `--dry-run`, schema introspection, and provider discovery. AI agents operate hookpipe without reading docs.

## Status

| Feature | Status | Notes |
|---|---|---|
| Webhook ingestion with signature verification | ✅ Implemented | Stripe, GitHub, generic HMAC |
| Reliable delivery with retries (exponential/linear/fixed) | ✅ Implemented | Respects `Retry-After` headers |
| Circuit breaker per destination | ✅ Implemented | Open/half-open/closed with auto-recovery |
| Fan-out routing (one source → multiple destinations) | ✅ Implemented | Event type wildcard filters |
| Dead letter queue with batch replay | ✅ Implemented | Per-destination DLQ inspection and replay |
| REST API (CRUD for all resources) | ✅ Implemented | Sources, destinations, subscriptions, events, keys |
| API key authentication (simple + advanced mode) | ✅ Implemented | Env var or D1-managed keys with scopes |
| CLI with `--json`, `--dry-run`, `--data`, `--fields` | ✅ Implemented | Agent-optimized |
| `hookpipe schema` (runtime API introspection) | ✅ Implemented | Agent-friendly resource discovery |
| Export / Import / Migrate | ✅ Implemented | Instance-to-instance migration with ID remapping |
| Idempotency (KV-based deduplication) | ✅ Implemented | Configurable TTL |
| Payload archive (R2) | ✅ Implemented | Configurable retention |
| Rate limiting (per-source ingress) | ✅ Implemented | DO-based precise global limiting with in-memory pre-check |
| `hookpipe dev` (local tunnel + signature verification) | ✅ Implemented | Cloudflare Quick Tunnel, auto-downloads cloudflared |
| `hookpipe connect` (one-shot setup) | ✅ Implemented | Source + destination + subscription in one command |
| `hookpipe providers` (provider catalog) | ✅ Implemented | Browse providers and event types |
| Pre-built providers (Stripe, GitHub, Slack, Shopify, Vercel) | ✅ Implemented | Event catalogs, verification, presets |
| `defineProvider()` (community providers) | ✅ Implemented | One file, three fields, publish to npm or GitHub |
| SSRF protection on destination URLs | ✅ Implemented | Blocks private IPs, localhost, non-HTTPS |
| Payload size limit (256KB) | ✅ Implemented | Returns 413 on oversized webhooks |
| DLQ notifications | ✅ Implemented | Webhook callback when deliveries permanently fail |
| **0% error rate under load** | ✅ Verified | [P50 303ms, 0 errors, DO-based rate limiting](BENCHMARKS.md) |
| Dashboard (static SPA) | 📋 Planned | Cloudflare Pages, connects to any instance |
| Structured logging | 📋 Planned | JSON logs for observability |

## Quick Start

### One-Click Deploy

Click the Deploy to Cloudflare button above. Cloudflare will provision D1, KV, Queues, Durable Objects, and R2 automatically.

### Manual Setup

```bash
git clone https://github.com/hookpipe/hookpipe.git
cd hookpipe
pnpm install
pnpm --filter @hookpipe/shared build
pnpm --filter @hookpipe/worker dev
```

### Local Development

Receive real webhooks on your local machine — no port forwarding, no exposed IP:

```bash
npm i -g hookpipe

hookpipe dev --port 3000 --provider stripe --secret whsec_xxx
```

```
✓ Tunnel established
✓ Stripe signature verification: enabled

  Webhook URL:  https://random-words.trycloudflare.com
  Forwarding:   → http://localhost:3000

[12:00:01] payment_intent.succeeded  ✓ sig  → localhost:3000 (200, 45ms)
```

Paste the Webhook URL into your Stripe Dashboard. hookpipe verifies signatures locally and forwards to your app. `cloudflared` is downloaded automatically if not installed.

### Send Your First Webhook

```bash
npm i -g hookpipe

# Point CLI to your hookpipe instance
hookpipe config set api_url http://localhost:8787

# Create your first API key (only needed once, on fresh deploy)
curl -X POST http://localhost:8787/api/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"name": "admin"}'
# → Returns your API key (hf_sk_xxx). Store it securely — shown only once.

hookpipe config set token hf_sk_xxx

# Connect Stripe in one command
hookpipe connect stripe \
  --secret whsec_your_stripe_webhook_secret \
  --to https://myapp.com/webhooks \
  --events "payment_intent.*"
```

```
✓ Connected stripe → https://myapp.com/webhooks

  Source:       src_abc123 (stripe)
  Destination:  dst_def456 (myapp-com)
  Events:       payment_intent.*
  Webhook URL:  http://localhost:8787/webhooks/src_abc123

  Next steps:
    Add the webhook URL as an endpoint in Stripe Dashboard → Developers → Webhooks
    Dashboard: https://dashboard.stripe.com/webhooks
```

One command creates source, destination, and subscription. Paste the Webhook URL into your provider's dashboard.

### Monitor

```bash
# Stream events in real-time (like tail -f)
hookpipe tail

# Filter by source
hookpipe tail --source src_abc123

# Pipe to an agent or script
hookpipe tail --json | ./my-agent

# List recent events
hookpipe events ls --json --limit 10

# Check circuit breaker status
hookpipe dest get dst_def456 --json
```

## Architecture

hookpipe runs entirely on Cloudflare's edge network with zero external dependencies:

```
Webhook Source (Stripe, GitHub, ...)         Your Application (API)
        |                                           ^
        v                                           |
  [Ingress Worker] --> [Queue] --> [Consumer] --> [Delivery DO] --> fetch()
     |       |                        |               |
     v       v                        v               v
  [Rate    [KV]                     [D1]            [R2]
  Limiter  idempotency           config/logs     payload archive
    DO]
```

| Component | Cloudflare Service | Role |
|---|---|---|
| **Ingress Worker** | Workers | Receives webhooks, verifies signatures, enqueues |
| **Rate Limiter** | Durable Objects | Per-source precise global rate limiting |
| **Message Queue** | Queues | Durable buffer — guarantees no event loss |
| **Consumer Worker** | Workers | Reads from queue, archives payload (R2), records event (D1), dispatches |
| **Delivery Manager** | Durable Objects | Per-destination retry state machine with backoff |
| **Config & Logs** | D1 (SQLite) | Sources, destinations, subscriptions, delivery logs |
| **Idempotency Cache** | KV | Deduplication keys with TTL (read on ingress, write on accept) |
| **Payload Archive** | R2 | Long-term storage for webhook payloads (written by consumer, not ingress) |

## Delivery Guarantee

hookpipe provides **at-least-once delivery**. Each stage of the pipeline is protected:

| Stage | What happens on failure | Data safe? |
|---|---|---|
| Ingress Worker crashes before queue | Provider gets non-2xx, provider retries | ✅ Provider holds the event |
| Ingress succeeds, queue write fails | Worker returns 500, provider retries | ✅ Provider holds the event |
| Queue → Consumer crash mid-flight | Cloudflare Queues retries (up to 3x), then DLQ | ✅ Queue holds the event |
| Consumer → Delivery DO crash | Queue retries the message | ✅ Queue holds the event |
| Delivery to your API fails (5xx/timeout) | Exponential backoff retries (up to 24h) | ✅ DO holds the task |
| All retries exhausted | Event moved to DLQ, stays in D1 | ✅ Payload in R2, replayable |

**What hookpipe does NOT guarantee:**
- **Exactly-once delivery** — your handler may receive the same event more than once. Use the `X-Hookpipe-Event-Id` header for idempotency.
- **Ordering** — events may arrive out of order under retry scenarios.

## Failure Modes

| Scenario | What happens | Recovery |
|---|---|---|
| Your API is down | Delivery retries with backoff (up to 24h) | Automatic when your API recovers |
| Your API returns 500 continuously | Circuit breaker opens after 10 failures, pauses delivery | Auto-probes every 5 min, resumes on success |
| Delivery retries exhausted | Event moved to DLQ status | `POST /destinations/:id/replay-failed` to batch retry |
| hookpipe Worker crashes | Cloudflare restarts automatically (stateless) | Automatic, sub-second |
| D1 database unavailable | Ingress returns 500, provider retries | Automatic when D1 recovers |
| R2 unavailable | Payload not archived, event still queued | Event delivered without archive |
| KV unavailable | Idempotency check skipped | Possible duplicate delivery (at-least-once) |

## Limits & Cost

hookpipe runs on Cloudflare's free tier. Some services (R2, Queues) may require a Cloudflare account with billing enabled.

**Free tier capacity: ~50,000 events/day** (bottleneck: D1 writes).

| Resource | Free limit / day | hookpipe usage per event |
|---|---|---|
| Workers requests | 100,000 | ~2 (ingress + consumer) |
| Durable Object requests | 100,000 | ~1 (delivery) |
| DO duration | 13,000 GB-s | ~0.025 GB-s (~200ms per delivery) |
| D1 rows written | 100,000 | ~2 (event + delivery log) |
| D1 rows read | 5,000,000 | ~4 (source + subscription lookup) |
| Queues messages | 1,000,000 / month | ~1 |
| R2 Class A ops | 1,000,000 / month | ~1 (payload archive) |

**Workers Paid ($5/month) — for higher volume:**

| Volume | Estimated cost | Notes |
|---|---|---|
| 50,000 events/month | $0 | Free tier covers it |
| 500,000 events/month | ~$5 | Base plan covers most usage |
| 5,000,000 events/month | ~$7-12 | DO requests + D1 writes overage |
| 50,000,000 events/month | ~$40-80 | All resources contribute |

For comparison: self-hosting Convoy or Svix requires a VM + PostgreSQL + Redis = $15-45/month minimum, regardless of volume.

## Retry Policy

Three retry strategies, configurable per destination:

| Strategy | Behavior |
|---|---|
| **exponential** (default) | Delay doubles each attempt with jitter |
| **linear** | Constant interval between retries |
| **fixed** | Same delay every time |

Default exponential schedule (10 retries, 1 min base, 24h cap):

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | ~1 minute |
| 3 | ~2 minutes |
| 4 | ~4 minutes |
| 5 | ~8 minutes |
| 6 | ~16 minutes |
| 7 | ~32 minutes |
| 8 | ~1 hour |
| 9 | ~2 hours |
| 10 | ~4 hours |
| DLQ | After all retries exhausted (~8 hour span) |

Each destination can override strategy, retry count, interval, and which HTTP status codes trigger retries. Destinations can also respond with a `Retry-After` header to control retry timing.

## CLI

```bash
# npm
npm i -g hookpipe

# Homebrew
brew install hookpipe/hookpipe/hookpipe
```

### Local Development Tunnel

```bash
hookpipe dev --port 3000 --provider stripe --secret whsec_xxx   # Stripe with verification
hookpipe dev --port 3000 --provider github --secret ghsec_xxx   # GitHub with verification
hookpipe dev --port 3000                                         # Any webhook, no verification
```

Uses [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — no account needed, no port forwarding, no IP exposure.

### One-Shot Connect

```bash
hookpipe connect stripe --secret whsec_xxx --to https://api.example.com/hooks --events "payment_intent.*"
hookpipe connect github --secret ghsec_xxx --to https://api.example.com/hooks --events "push,pull_request"
hookpipe connect stripe --secret whsec_stg --to https://staging.example.com/hooks --name stripe-staging
```

### Provider Catalog

```bash
hookpipe providers ls                      # list all providers
hookpipe providers describe stripe --json  # events, presets, verification
```

### Agent-Friendly Features

The CLI is designed as an **agent-first** interface — AI agents can operate hookpipe without reading documentation:

| Feature | Flag/Command | Purpose |
|---|---|---|
| One-shot setup | `hookpipe connect` | Source + destination + subscription in one command |
| Provider catalog | `hookpipe providers ls/describe` | Browse events and verification at runtime |
| Structured output | `--json` | Machine-parseable JSON on all commands |
| Raw JSON input | `-d / --data` | Send full API payload, skip flag mapping |
| Schema introspection | `hookpipe schema` | Discover API resources and fields |
| Dry run | `--dry-run` | Validate mutations without executing |
| Field selection | `--fields` | Limit output columns, save context tokens |
| Export/Import | `hookpipe export/import` | Pipe-friendly config transfer |
| Migrate | `hookpipe migrate` | One-command instance-to-instance migration |

```bash
# Agent workflow: discover → validate → execute
hookpipe providers describe stripe --json                                       # discover events
hookpipe connect stripe --secret whsec_xxx --to https://... --dry-run           # validate
hookpipe connect stripe --secret whsec_xxx --to https://... --events "payment_intent.*"  # execute
```

See [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) for the full agent guide.

## API Reference

### Sources

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/sources` | Create a source |
| `GET` | `/api/v1/sources` | List sources |
| `GET` | `/api/v1/sources/:id` | Get source details |
| `PUT` | `/api/v1/sources/:id` | Update a source |
| `DELETE` | `/api/v1/sources/:id` | Delete a source |

### Destinations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/destinations` | Create a destination |
| `GET` | `/api/v1/destinations` | List destinations |
| `GET` | `/api/v1/destinations/:id` | Get destination details |
| `PUT` | `/api/v1/destinations/:id` | Update a destination |
| `DELETE` | `/api/v1/destinations/:id` | Delete a destination |
| `GET` | `/api/v1/destinations/:id/circuit` | Circuit breaker state |
| `GET` | `/api/v1/destinations/:id/failed` | List failed deliveries (DLQ) |
| `POST` | `/api/v1/destinations/:id/replay-failed` | Batch replay all DLQ events |

### Subscriptions

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/subscriptions` | Create a subscription |
| `GET` | `/api/v1/subscriptions` | List subscriptions |
| `DELETE` | `/api/v1/subscriptions/:id` | Delete a subscription |

### Events & Delivery

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/events` | List received events |
| `GET` | `/api/v1/events/:id` | Get event details and payload |
| `GET` | `/api/v1/events/:id/deliveries` | List delivery attempts for an event |
| `POST` | `/api/v1/events/:id/replay` | Replay an event to its destinations |

### API Keys

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/keys` | Create an API key |
| `GET` | `/api/v1/keys` | List API keys |
| `DELETE` | `/api/v1/keys/:id` | Revoke an API key |

### Export / Import

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/export` | Export all configuration |
| `POST` | `/api/v1/import` | Import configuration (dedup by name) |

### Webhook Ingestion

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/:source_id` | Ingest a webhook from a source (public, rate-limited) |

## Roadmap

### v0.1 — Core Engine ✅

Webhook ingestion, queue-based delivery, configurable retry strategies, circuit breaker, API key auth, export/import/migrate, agent-optimized CLI.

### v0.2 — Provider System ✅

- `hookpipe connect` one-shot command
- `hookpipe providers ls/describe` catalog
- Built-in Stripe, GitHub, Slack, Shopify, Vercel providers with event type catalogs
- Community-extensible via `defineProvider()` — one file, three fields, publish to npm or GitHub

### v0.3 — Observability (current)

DLQ notifications via webhook callback (✅ done), structured JSON logging, delivery metrics, Cloudflare Logpush integration.

### v0.4 — Dashboard

Static SPA dashboard on Cloudflare Pages. Connects to any hookpipe instance via API URL + token.

### v1.0 — Production Ready

Comprehensive test coverage, load testing results, security audit, stable API, semantic versioning.

## Development

```bash
pnpm install
pnpm --filter @hookpipe/shared build
pnpm --filter @hookpipe/worker dev       # Start local dev server
pnpm --filter @hookpipe/worker test      # Run tests
pnpm --filter @hookpipe/worker typecheck # Type check
pnpm --filter hookpipe build             # Build CLI
```

### Tests

123 tests across 10 test files, running on the actual Cloudflare Workers runtime via `vitest-pool-workers`:

- **Ingress**: signature verification (Stripe `t=,v1=`, GitHub HMAC, Shopify Base64), idempotency dedup, event type parsing
- **Delivery**: retry strategies (exponential/linear/fixed), status code filtering, circuit breaker state transitions
- **API**: CRUD for all resources, authentication, bootstrap, input validation, secret masking
- **Transfer**: export/import roundtrip, ID remapping, dedup by name

## Project Structure

```
hookpipe/
├── packages/
│   ├── worker/              # Cloudflare Worker (webhook engine)
│   │   ├── src/
│   │   │   ├── index.ts     # Worker entry point and Hono router
│   │   │   ├── auth/        # API key authentication middleware
│   │   │   ├── ingress/     # Webhook ingestion and signature verification
│   │   │   ├── queue/       # Queue consumer and dispatch logic
│   │   │   ├── delivery/    # Durable Object retry management + circuit breaker
│   │   │   ├── api/         # REST API handlers
│   │   │   ├── db/          # Drizzle ORM schema and queries
│   │   │   └── lib/         # Shared utilities (crypto, errors, IDs)
│   │   ├── migrations/      # D1 database migrations
│   │   └── test/            # Integration tests (vitest + Workers runtime)
│   ├── shared/              # Shared TypeScript types
│   ├── cli/                 # CLI tool (npm: hookpipe)
│   └── providers/           # Provider definitions (🚧 in progress)
├── .github/workflows/       # CI (typecheck + test)
├── turbo.json               # Turborepo task config
├── pnpm-workspace.yaml      # pnpm workspaces
└── LICENSE                  # Apache 2.0
```

## How hookpipe compares

hookpipe focuses on **receiving and reliably forwarding** webhooks. It is not a replacement for outgoing webhook services.

| If you need to... | Consider |
|---|---|
| Receive webhooks and forward to your API | **hookpipe**, Hookdeck, Convoy |
| Send webhooks to your customers | Svix, Convoy |
| Both incoming and outgoing | Convoy |

### Why hookpipe?

- **Zero infrastructure** — No Docker, PostgreSQL, or Redis. Runs entirely on Cloudflare Workers.
- **Free to start** — Runs on Cloudflare's free tier (~50K events/day). No VM costs, $0 idle.
- **Deploy in 30 seconds** — One-click Cloudflare deploy button provisions everything automatically.
- **Agent-optimized** — CLI with `--json`, `--dry-run`, schema introspection. AI agents can operate hookpipe without reading docs.
- **Apache 2.0** — No restrictions on commercial use or self-hosting.
- **Local dev tunnel** — `hookpipe dev` creates a secure tunnel to localhost via Cloudflare. No port forwarding, no IP exposure.

## Community Providers

These providers are maintained by the community. To add yours, submit a PR.

| Provider | Package | Description |
|---|---|---|
| *Be the first!* | [Create from template](https://github.com/hookpipe/hookpipe-provider-template) | ~10 minutes, no npm account needed |

## Contributing

We welcome contributions! The easiest way to start is building a provider — it's a single file with a well-defined interface, and you don't need npm or a review process.

- **[Build a provider](CONTRIBUTING.md#build-a-provider)** — ~10 minutes from template to working provider
- **[Provider Design Guide](packages/providers/DESIGN.md)** — full capability specification
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — development setup, code style, how to submit PRs

## License

[Apache 2.0](LICENSE)

## Disclaimer

hookpipe is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" and the Cloudflare logo are trademarks of Cloudflare, Inc.
