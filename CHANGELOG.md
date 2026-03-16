# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Core webhook engine: ingress → queue → delivery with Durable Objects
- Signature verification: Stripe (`t=,v1=` format), GitHub (`x-hub-signature-256`), generic HMAC-SHA256
- Configurable retry strategies: exponential, linear, fixed (per destination)
- `Retry-After` header support from destinations
- Circuit breaker per destination (closed/open/half-open with auto-recovery)
- Dead letter queue with batch replay (`/destinations/:id/replay-failed`)
- REST API for sources, destinations, subscriptions, events, keys
- API key authentication (simple env var mode + advanced D1-managed keys)
- Export/Import/Migrate between instances with ID remapping
- CLI (`npm: hookflare`) with agent-optimized features:
  - `--json` structured output on all commands
  - `-d/--data` raw JSON input
  - `--dry-run` on all mutations
  - `--fields` on list commands
  - `hookflare schema` runtime API introspection
  - `hookflare export/import/migrate`
- `AGENTS.md` skill file for AI agent operators
- Rate limiting on webhook ingress (KV-based)
- Payload archive in R2 with configurable retention
- Idempotency via KV with configurable TTL
- CI: GitHub Actions (typecheck + test)
- Drizzle ORM with D1
- pnpm + Turborepo monorepo
