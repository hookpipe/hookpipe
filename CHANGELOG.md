# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.2.0-alpha] — 2026-03-16

Provider system, one-shot `connect` command, security hardening, performance optimization.

### Added

- **Provider system** — `defineProvider()` framework with 5 built-in providers (Stripe, GitHub, Slack, Shopify, Vercel), event type catalogs, and community-extensible via npm or GitHub
- **`hookpipe connect`** — one-shot setup: source + destination + subscription in one command
- **`hookpipe providers ls/describe`** — browse and inspect provider capabilities at runtime
- **`hookpipe dev`** — local development tunnel via Cloudflare Quick Tunnel with provider-aware signature verification
- **`hookpipe tail`** — real-time event and delivery streaming (like `tail -f`)
- **Bootstrap endpoint** — `POST /api/v1/bootstrap` creates first admin key on fresh deployment, self-locks after first use
- **SSRF protection** — destination URLs validated against private IPs, localhost, metadata endpoints; HTTPS required by default
- **Payload size limit** — 256KB max on webhook ingress, returns 413
- **DLQ notifications** — webhook callback (`DLQ_NOTIFICATION_URL` env var) when deliveries permanently fail
- **Zod input validation** — all API endpoints validate with structured error responses
- **Secret masking** — verification secrets masked in GET responses (`****xxxx`), full secret only on creation
- **DO-based rate limiter** — precise global rate limiting per source via Durable Object, with in-memory pre-check
- **`after` timestamp filter** — events and deliveries list endpoints support cursor-based pagination
- **Homebrew tap** — `brew install hookpipe/tap/hookpipe`
- **Agent skill** — `hookpipe-webhooks` skill for the npx skills ecosystem
- **SECURITY.md** — vulnerability reporting process, security design, known limitations
- **CONTRIBUTING.md** — getting started guide, provider contribution path with ecosystem tiers
- **BENCHMARKS.md** — production benchmark methodology and results

### Changed

- **Ingress performance** — R2 write and D1 event creation deferred to queue consumer (P50: 860ms → 303ms)
- **Rate limiter** — replaced KV-based (race conditions, quota exhaustion) with DO-based (precise, global, 0% error)
- **Auth middleware** — no longer allows unauthenticated access on fresh deployment; requires bootstrap or `API_TOKEN`
- **Source schema** — added `provider` field linking to provider definitions
- **Queue message** — now carries raw payload (consumer handles R2 archive + D1 write)
- **Source lookup** — cached in-memory (60s TTL) to eliminate D1 read on ingress hot path

### Fixed

- Commander `--version` / `--help` returning exit code 1 instead of 0
- Circuit breaker stall in half_open state (added 30s watchdog)
- CI D1 isolation flake (split test batches, sequential execution)

### Security

- Verification secrets masked in all GET responses
- API keys stored as SHA-256 hashes (never stored in plaintext)
- SSRF protection on destination URLs
- Payload size enforcement (256KB)
- Bootstrap endpoint self-locks after first admin key creation
- Timing-safe signature comparison for all HMAC verification

## [0.1.0-alpha] — 2026-03-16

Initial release. Core webhook engine.

### Added

- **Webhook ingress** — receive webhooks at Cloudflare edge, return 202 Accepted immediately
- **Signature verification** — Stripe (`t=,v1=` format), GitHub (`x-hub-signature-256`), generic HMAC-SHA256
- **Reliable delivery** — queue-based with configurable retry strategies (exponential, linear, fixed)
- **`Retry-After` header** — destinations can control retry timing
- **Circuit breaker** — per-destination (closed/open/half-open with auto-recovery)
- **Dead letter queue** — batch replay via `POST /destinations/:id/replay-failed`
- **REST API** — CRUD for sources, destinations, subscriptions, events, API keys
- **API key authentication** — simple mode (`API_TOKEN` env var) + advanced mode (D1-managed keys with scopes)
- **Export/Import/Migrate** — instance-to-instance migration with ID remapping
- **CLI** (`npm: hookpipe`) with agent-optimized features:
  - `--json` structured output on all commands
  - `-d/--data` raw JSON input on create commands
  - `--dry-run` on all mutations
  - `--fields` on list commands
  - `hookpipe schema` runtime API introspection
  - `hookpipe export/import/migrate`
- **`AGENTS.md`** — skill file for AI agent operators
- **Idempotency** — KV-based deduplication with configurable TTL
- **Payload archive** — R2 storage with configurable retention
- **CI** — GitHub Actions (typecheck + test)
- **Drizzle ORM** with D1 (type-safe schema + queries)
- **pnpm + Turborepo** monorepo
- **Apache 2.0** license

[Unreleased]: https://github.com/hookpipe/hookpipe/compare/v0.2.0-alpha...HEAD
[0.2.0-alpha]: https://github.com/hookpipe/hookpipe/compare/v0.1.0-alpha...v0.2.0-alpha
[0.1.0-alpha]: https://github.com/hookpipe/hookpipe/releases/tag/v0.1.0-alpha
