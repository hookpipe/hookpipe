# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

hookpipe is an open-source webhook infrastructure service built entirely on the Cloudflare Workers ecosystem. It receives incoming webhooks, queues them durably, and reliably delivers them to configured destinations with retry logic. GitHub org: `hookpipe`.

## Monorepo Structure (pnpm + Turborepo)

```
hookpipe/
├── packages/
│   ├── worker/        # Cloudflare Worker — webhook engine (Hono + D1 + Drizzle)
│   ├── shared/        # Shared TypeScript types (API entities, export format)
│   ├── cli/           # CLI tool (npm: hookpipe) — agent-optimized
│   └── providers/     # Built-in provider definitions (Stripe, GitHub, Slack, Shopify, Vercel)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Tech Stack

- **Runtime**: Cloudflare Workers (TypeScript)
- **Framework**: Hono (lightweight edge-native router)
- **ORM**: Drizzle ORM (type-safe, zero overhead)
- **Validation**: Zod (runtime input validation on all API endpoints)
- **Database**: Cloudflare D1 (SQLite)
- **Queue**: Cloudflare Queues (durable message buffer)
- **Cache**: Cloudflare KV (idempotency keys only)
- **State**: Cloudflare Durable Objects (DeliveryManager for retries, RateLimiter for rate limiting)
- **Storage**: Cloudflare R2 (webhook payload archive)
- **CLI**: Commander + tsup (published as `hookpipe` on npm)

## Commands

```bash
pnpm install                                    # Install all dependencies
pnpm --filter @hookpipe/shared build           # Build shared types (do this first)
pnpm --filter @hookpipe/providers build        # Build providers (do this second)
pnpm --filter @hookpipe/worker dev             # Start local dev server (wrangler dev)
pnpm --filter @hookpipe/worker test            # Run tests (vitest + Workers runtime)
pnpm --filter @hookpipe/worker typecheck       # TypeScript type checking
pnpm --filter @hookpipe/worker db:migrate:local # Run D1 migrations locally
pnpm --filter hookpipe build                   # Build CLI
pnpm --filter hookpipe typecheck               # Typecheck CLI
```

## Architecture

### Core Flow (optimized for latency)

**Ingress (hot path — ~300ms):**
1. Source lookup (in-memory cache, 60s TTL — avoids D1 read)
2. Signature verification (provider-aware: Stripe, GitHub, Slack, etc.)
3. Idempotency check (KV read, only if header present)
4. Rate limit check (in-memory pre-check + RateLimiter DO)
5. Enqueue to Cloudflare Queue + KV idempotency write (parallel)
6. Return `202 Accepted`

**Queue Consumer (async, after 202):**
1. Archive payload to R2
2. Record event in D1
3. Resolve subscriptions, dispatch to DeliveryManager DO per destination

**Delivery Manager DO (per destination):**
1. Circuit breaker check (closed/open/half-open)
2. Outbound `fetch()` with timeout
3. On failure: exponential/linear/fixed backoff via alarm API
4. On exhaustion: DLQ + notification webhook

### Authentication

- `/webhooks/*` and `/health` — public (no auth)
- `POST /api/v1/bootstrap` — unauthenticated, one-time, self-locks after first use
- `/api/v1/*` — requires Bearer token
  - Simple mode: `API_TOKEN` env var
  - Advanced mode: D1-managed API keys (`hf_sk_*` prefix, SHA-256 hashed)
- Bootstrap mode: if no auth configured, all `/api/v1/*` returns `SETUP_REQUIRED` except bootstrap

### Data Model (Drizzle schema at `packages/worker/src/db/schema.ts`)

- **Source** — webhook receiver endpoint, optionally references a `provider` (e.g., "stripe")
- **Destination** — target URL with retry policy (strategy, max retries, interval, status codes)
- **Subscription** — connects source → destination, with event type wildcard filters
- **Event** — received webhook payload with metadata (created async by queue consumer)
- **Delivery** — delivery attempt log (status, latency, response body snippet)
- **ApiKey** — management API key (SHA-256 hash, scopes, expiration, revocation)

### Providers (packages/providers/)

Providers are static knowledge definitions for webhook senders. Each provider defines:
- Signature verification method and header
- Known event types with descriptions
- Payload parsing (event type extraction)
- Optional: challenge-response handling (Slack), presets

A `provider` field on Source links to a provider definition. See `packages/providers/DESIGN.md`.

### API Routes

**Public:**
- `POST /webhooks/:source_id` — Webhook ingestion (rate-limited)
- `GET /health` — Health check with `setup_required` flag

**Bootstrap (one-time, self-locks):**
- `POST /api/v1/bootstrap` — Create first admin key

**Authenticated (`/api/v1/*`):**
- `sources` — CRUD + provider field
- `destinations` — CRUD + circuit breaker status + DLQ inspection + batch replay
- `subscriptions` — create, list, delete
- `events` — list (with `after` cursor), get (with R2 payload), deliveries, replay
- `keys` — create, list, revoke
- `export` / `import` — configuration backup and migration

### CLI (packages/cli/)

Agent-optimized CLI:
- `hookpipe connect <provider>` — one-shot setup (source + destination + subscription)
- `hookpipe providers ls/describe` — browse provider catalog and event types
- `hookpipe dev` — local development tunnel with signature verification
- `hookpipe tail` — real-time event and delivery streaming
- `hookpipe schema` — runtime API introspection
- `hookpipe export/import/migrate` — instance migration
- `--json`, `-d/--data`, `--dry-run`, `--fields` on all commands
- See `packages/cli/AGENTS.md` for agent-specific guidance

### Security

- SSRF protection: destination URLs validated (block private IPs, localhost, non-HTTPS)
- Payload size limit: 256KB max on ingress
- Secrets masked in GET responses (`****xxxx`), full secret only on creation
- Timing-safe signature comparison for all HMAC verification

### Performance Design

- Source lookup cached in-memory (60s TTL) — no D1 read on hot path
- R2 write + D1 event creation deferred to queue consumer (not on ingress)
- DO-based rate limiter with in-memory pre-check (no KV on hot path)
- Queue send + KV idempotency write run in parallel
- Benchmark: P50 303ms, 0% error rate at 50 concurrent ([BENCHMARKS.md](BENCHMARKS.md))

## Testing

Tests use `@cloudflare/vitest-pool-workers` and run inside the Workers runtime.

```bash
# Run all tests
pnpm --filter @hookpipe/worker test

# Run specific test file
npx vitest run test/api.test.ts
```

CI runs tests in batches to avoid D1 isolation flakes:
1. Unit tests (crypto, circuit-breaker, delivery) — no D1 dependency
2. Integration batch 1 (api, bootstrap, validation)
3. Integration batch 2 (secret-masking, transfer, delivery-manager)
4. Integration batch 3 (security)

When adding tests:
- Tests that use `SELF.fetch()` (API integration) need `migrateDb()` + `bootstrap()` in `beforeEach`
- Tests for pure functions (crypto, retry math) don't need DB setup
- Use `request()` helper for authenticated requests, `unauthRequest()` for unauthenticated

## Code Conventions

- All code, comments, and documentation in US English (en-US).
- Configuration via `wrangler.jsonc` environment variables and D1 database.
- Drizzle ORM for all database operations (schema in `src/db/schema.ts`).
- Zod schemas for all API input validation (in `src/lib/validation.ts`).
- Atomic commits with conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `perf:`, `security:`, `refactor:`, `chore:`.
- Changelog follows [Keep a Changelog](https://keepachangelog.com/) format with Added/Changed/Fixed/Security categories.
- Versioning follows [Semantic Versioning](https://semver.org/). Update CHANGELOG.md when adding features or fixing bugs.
- 0% error rate is a non-negotiable quality bar. Any change that introduces errors under load must be fixed before merging.
