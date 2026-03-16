/**
 * RateLimiter Durable Object — precise, global rate limiting per source.
 *
 * One instance per source_id. Uses in-memory state only (no storage writes).
 * DO serializes all requests, eliminating race conditions.
 *
 * Design:
 * - Sliding window counter (configurable window, default 60s)
 * - Resets when window expires
 * - No storage writes = no DO storage billing
 * - If DO is evicted, counter resets (acceptable for rate limiting)
 *
 * Cost:
 * - Free tier: 100K DO requests/day (shared with DeliveryManager)
 * - Paid tier: $0.15 per million requests
 */
export class RateLimiter implements DurableObject {
  private count = 0;
  private windowStart = 0;

  // Defaults — can be overridden per request
  private readonly defaultLimit = 100;
  private readonly defaultWindowMs = 60_000;

  constructor(
    _state: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/check") {
      return this.checkRate(url);
    }

    if (url.pathname === "/status") {
      return this.getStatus();
    }

    return new Response("Not found", { status: 404 });
  }

  private checkRate(url: URL): Response {
    const limit = parseInt(url.searchParams.get("limit") ?? String(this.defaultLimit), 10);
    const windowMs = parseInt(url.searchParams.get("window_ms") ?? String(this.defaultWindowMs), 10);
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart > windowMs) {
      this.count = 0;
      this.windowStart = now;
    }

    this.count++;

    const remaining = Math.max(0, limit - this.count);
    const retryAfterMs = this.count > limit ? Math.max(0, windowMs - (now - this.windowStart)) : 0;

    if (this.count > limit) {
      return Response.json(
        { allowed: false, remaining: 0, retry_after_ms: retryAfterMs },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0",
            "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
          },
        },
      );
    }

    return Response.json(
      { allowed: true, remaining },
      {
        headers: {
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(remaining),
        },
      },
    );
  }

  private getStatus(): Response {
    const now = Date.now();
    const windowMs = this.defaultWindowMs;
    const elapsed = now - this.windowStart;
    const windowActive = elapsed < windowMs;

    return Response.json({
      count: windowActive ? this.count : 0,
      window_start: this.windowStart,
      window_active: windowActive,
      elapsed_ms: elapsed,
    });
  }
}
