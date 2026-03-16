# hookflare

**Never miss a webhook.** CLI for [hookflare](https://github.com/hookedge/hookflare) — open-source webhook infrastructure on Cloudflare Workers.

```bash
npm i -g hookflare
```

## Quick Start

```bash
# Connect to your hookflare instance
hookflare config set api_url https://your-hookflare.workers.dev
hookflare init

# Set up Stripe webhooks in one command
hookflare connect stripe \
  --secret whsec_your_secret \
  --to https://api.myapp.com/hooks \
  --events "payment_intent.*"
```

## Agent-Friendly

hookflare CLI is designed as an **agent-first** interface. AI agents can operate hookflare without reading documentation.

```bash
# Discover → Validate → Execute
hookflare schema sources                                    # discover API fields
hookflare connect stripe --dry-run --json -d '{...}'        # validate
hookflare connect stripe --json -d '{...}'                  # execute
```

| Feature | Flag/Command | Purpose |
|---|---|---|
| Structured output | `--json` | Machine-parseable JSON on all commands |
| Raw JSON input | `-d / --data` | Full API payload, skip flag mapping |
| Schema introspection | `hookflare schema` | Discover resources and fields at runtime |
| Provider catalog | `hookflare providers` | Browse supported webhook services |
| Dry run | `--dry-run` | Validate mutations without executing |
| Field selection | `--fields` | Limit output columns, save context tokens |

## Commands

```bash
hookflare connect <provider>    # One-shot: source + destination + subscription
hookflare providers ls          # List supported webhook providers
hookflare providers describe    # Inspect provider events and verification
hookflare dev                   # Local dev tunnel with signature verification
hookflare tail                  # Real-time event and delivery streaming

hookflare sources ls/create/rm  # Manage webhook sources
hookflare dest ls/create/rm     # Manage destinations
hookflare subs ls/create/rm     # Manage subscriptions
hookflare events ls/get/replay  # View events and deliveries

hookflare export/import         # Backup and restore configuration
hookflare migrate               # Instance-to-instance migration
hookflare health                # Check server connectivity
hookflare schema [resource]     # API schema introspection
hookflare config set/get        # CLI configuration
hookflare init                  # Bootstrap a fresh instance
```

## Configuration

```bash
hookflare config set api_url https://your-hookflare.workers.dev
hookflare config set token hf_sk_your_api_key
```

Config is stored in `~/.hookflare/config.json`.

## For AI Agents

See [AGENTS.md](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md) for the complete agent guide, including:
- Rules (always use `--json`, `--dry-run`, `--data`)
- Common workflows (Stripe setup, monitoring, troubleshooting)
- Resource ID format (`src_`, `dst_`, `sub_`, `evt_`, `dlv_`, `key_`)
- DLQ notification setup
- Verification types table

## Links

- [GitHub](https://github.com/hookedge/hookflare)
- [Agent Guide (AGENTS.md)](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md)
- [Benchmarks](https://github.com/hookedge/hookflare/blob/main/BENCHMARKS.md)

## License

[Apache 2.0](https://github.com/hookedge/hookflare/blob/main/LICENSE)
