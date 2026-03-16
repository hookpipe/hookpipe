# Contributing to hookflare

Thank you for your interest in contributing to hookflare! This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/hookedge/hookflare.git
cd hookflare
pnpm install
pnpm --filter @hookflare/shared build
pnpm --filter @hookflare/worker test     # verify everything works
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run `pnpm --filter @hookflare/worker typecheck` and `pnpm --filter @hookflare/worker test`
4. Submit a pull request

## What to Work On

Check [open issues](https://github.com/hookedge/hookflare/issues) for tasks. Issues labeled `good first issue` are ideal for new contributors.

### Build a Provider

The highest-impact contribution right now is adding webhook providers. Each provider is a single file that defines how hookflare verifies and understands webhooks from a specific service.

See [`packages/providers/DESIGN.md`](packages/providers/DESIGN.md) for the full specification.

### Other Ways to Help

- Report bugs by [opening an issue](https://github.com/hookedge/hookflare/issues/new)
- Improve documentation
- Add test coverage (especially for the delivery Durable Object and circuit breaker)
- Review pull requests

## Project Structure

```
packages/
  worker/     → Cloudflare Worker (webhook engine)
  shared/     → Shared TypeScript types
  cli/        → CLI tool
  providers/  → Provider definitions
```

## Code Style

- TypeScript with strict mode
- No unnecessary abstractions — keep it direct and readable
- Use Drizzle ORM for all database operations
- Prefix IDs: `src_`, `dst_`, `sub_`, `evt_`, `dlv_`, `key_`

## Commit Messages

Use clear, descriptive commit messages:
- `feat: add GitHub provider with push event catalog`
- `fix: handle Stripe signature with multiple v1 values`
- `test: add circuit breaker state transition tests`
- `docs: update README retry policy section`

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
