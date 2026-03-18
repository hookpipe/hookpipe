# Benchmarks

Production benchmark results for hookpipe running on Cloudflare Workers.

## Environment

- **Runtime**: Cloudflare Workers (production deployment)
- **Region**: DFW (Dallas-Fort Worth edge)
- **Plan**: Workers Free tier
- **Tool**: [hey](https://github.com/rakyll/hey) + Python concurrent.futures
- **Date**: 2026-03-16

## Webhook Ingress (Core Path)

The ingress endpoint receives a webhook, verifies the signature (if configured), checks idempotency, and enqueues for delivery. Returns `202 Accepted`.

### Throughput & Latency

| Concurrency | Requests | RPS | Avg Latency | P50 | P95 | P99 | Error Rate |
|---|---|---|---|---|---|---|---|
| 10 | 50 | 25 | — | — | — | — | 0% |
| 20 | 100 | 47 | — | — | — | — | 0% |
| 50 | 200 | 128 | — | — | — | — | 0% |
| 50 | 500 | **149** | **265ms** | **239ms** | **570ms** | **642ms** | **0%** |

- 105 of the 500 requests returned `429 Rate Limited` (expected — default limit is 100 req/60s per source)
- Zero `500 Internal Server Error` responses

### Latency Distribution (500 requests, 50 concurrent)

```
  10%  in  20ms
  25%  in 170ms
  50%  in 239ms   ← P50
  75%  in 323ms
  90%  in 565ms
  95%  in 570ms
  99%  in 642ms
```

### What the Ingress Path Does

Each accepted request performs:
1. Source lookup (in-memory cache, 60s TTL — zero D1 reads after cold start)
2. Signature verification (HMAC-SHA256, timing-safe)
3. Idempotency check (KV read, only if header present)
4. Queue send (Cloudflare Queues)

Heavy I/O (R2 payload archive, D1 event record) is deferred to the queue consumer.

## Sequential Requests (Single Client)

| Request | Latency |
|---|---|
| 1 | 310ms |
| 2 | 480ms |
| 3 | 311ms |
| 4 | 398ms |
| 5 | 343ms |

Average: ~370ms per request for a single sequential client.

## Health Check (Baseline)

| Metric | Value |
|---|---|
| Avg Latency | 152ms |
| Fastest | 34ms |
| RPS | 130 |

This includes network round-trip from the client to the nearest Cloudflare edge. The Worker itself executes in <1ms (simple JSON response).

## Free Tier Capacity Estimate

Based on Cloudflare free tier limits:

| Resource | Free Limit | Per Event | Daily Capacity |
|---|---|---|---|
| Workers Requests | 100K/day | 1 (ingress) + 1 (consumer) | ~50K events |
| D1 Reads | 5M/day | ~3 (source + subscriptions + dest) | ~1.6M events |
| D1 Writes | 100K/day | ~2 (event + delivery) | ~50K events |
| DO Requests | 100K/day | ~1 (delivery dispatch) | ~100K events |
| Queue Messages | 1M/month | 1 | ~33K/day |
| KV Reads | 100K/day | 0-1 (idempotency, if header present) | ~100K events |
| R2 Class A Ops | 1M/month | 1 PUT (consumer) | ~33K/day |

**Bottleneck: ~33K events/day on free tier** (Queue messages limit).
**Paid plan ($5/mo)**: 10M Queue messages/month → ~330K events/day.

## How to Run

```bash
# Deploy to your Cloudflare account
cd packages/worker
npx wrangler deploy

# Bootstrap
curl -X POST https://your-worker.workers.dev/api/v1/bootstrap \
  -H "Content-Type: application/json" -d '{"name":"bench"}'

# Create a source
curl -X POST https://your-worker.workers.dev/api/v1/sources \
  -H "Authorization: Bearer hp_sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name":"bench-source"}'

# Run benchmark
hey -n 500 -c 50 -m POST \
  -H "Content-Type: application/json" \
  -d '{"type":"bench.test"}' \
  https://your-worker.workers.dev/webhooks/<source_id>
```

## Rate Limiting

hookpipe uses a two-layer rate limiter:

1. **In-memory pre-check** (0ms) — fast rejection for requests clearly over the limit
2. **RateLimiter Durable Object** (5-20ms) — precise, globally consistent counter per source

The DO layer adds ~60ms to P50 latency but provides real protection:
- One DO instance per source_id, serializable (no race conditions)
- No storage writes (in-memory counter only — resets on DO eviction)
- Graceful fallback: if DO is unavailable, in-memory check still works

| Metric | In-memory only | DO rate limiter (current) |
|---|---|---|
| P50 Latency | 239ms | **303ms** |
| Global accuracy | ❌ per-isolate | ✅ per-source |
| Race conditions | Possible | None |
| Error rate | 0% | **0%** |

Default: 100 requests per 60 seconds per source. Configurable. For strict global limits, use Cloudflare WAF rules.

## Optimization History

| Version | Avg Latency | RPS | Error Rate | Change |
|---|---|---|---|---|
| v0.1 (6 sequential I/O) | 860ms | 21 | 8-20% | Baseline |
| v0.2 (deferred R2+D1) | 420ms | 38 | 20% | KV rate limiter still on hot path |
| v0.3 (in-memory rate limit) | 265ms | 149 | 0% | Eliminated KV from hot path |
| **v0.4 (DO rate limiter)** | **303ms** | **60** | **0%** | **Current — precise global rate limiting** |

Key optimizations:
- Source lookup cached in-memory (60s TTL) — eliminates D1 read per request
- R2 write + D1 event creation deferred to queue consumer
- KV-based rate limiter replaced with DO-based — precise, zero race conditions, zero KV quota
- Queue send + KV idempotency write run in parallel
- In-memory pre-check reduces DO calls by ~80% under normal traffic
