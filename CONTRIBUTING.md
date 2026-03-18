# Contributing to hookpipe

Thank you for your interest in contributing to hookpipe! This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/hookpipe/hookpipe.git
cd hookpipe
pnpm install
pnpm --filter @hookpipe/shared build
pnpm --filter @hookpipe/worker test     # verify everything works
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run `pnpm --filter @hookpipe/worker typecheck` and `pnpm --filter @hookpipe/worker test`
4. Submit a pull request

## What to Work On

Check [open issues](https://github.com/hookpipe/hookpipe/issues) for tasks. Issues labeled `good first issue` are ideal for new contributors.

### Build a Provider

The highest-impact contribution right now is adding webhook providers. A provider is a single file that teaches hookpipe how to verify and understand webhooks from a specific service.

**Quickest path (~10 minutes, no npm account needed):**

1. Create a repo from the [provider template](https://github.com/hookpipe/hookpipe-provider-template):

   ```bash
   gh repo create yourname/hookpipe-provider-my-service \
     --template hookpipe/hookpipe-provider-template
   cd hookpipe-provider-my-service
   npm install
   ```

2. Edit `src/index.ts` — fill in `id`, `verification`, and `events` (minimum).

3. Run the tests — they'll fail until you change from the template defaults:

   ```bash
   npm test
   ```

4. Push to GitHub. Users can install directly:

   ```bash
   hookpipe connect my-service \
     --provider github:yourname/hookpipe-provider-my-service \
     --secret xxx --to https://...
   ```

5. Optionally, publish to npm as `hookpipe-provider-<name>` and submit a PR to add it to the [community providers list](#community-providers) in the README.

See [`packages/providers/DESIGN.md`](packages/providers/DESIGN.md) for the full specification, including support for encrypted payloads (`decode`), challenge-response (`challenge`), and multi-secret providers (`secrets`).

#### Provider Ecosystem Tiers

| Tier | Package naming | Maintained by |
|---|---|---|
| **Built-in** | Ships with `hookpipe/providers` | hookpipe team |
| **Official** | `@hookpipe/provider-<name>` | hookpipe org |
| **Community** | `hookpipe-provider-<name>` | Anyone |

Community providers can be promoted to official when they are stable, tested, and actively maintained.

### Other Ways to Help

- Report bugs by [opening an issue](https://github.com/hookpipe/hookpipe/issues/new)
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

By contributing to hookpipe core, you agree that your contributions will be licensed under the [Apache 2.0](LICENSE) license. Provider contributions using the [template](https://github.com/hookpipe/hookpipe-provider-template) are licensed under MIT by default — you may choose your own license for your provider.
