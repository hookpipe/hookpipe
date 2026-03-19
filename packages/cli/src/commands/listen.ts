/**
 * hp listen — agent event consumption pipeline.
 *
 * Streams webhook events with full payloads via NDJSON.
 * Tracks consumption progress server-side (consumer cursor)
 * so agents resume from where they left off after restart.
 *
 * Usage:
 *   hp listen --source src_stripe --json | python agent.py
 */

import { Command } from "commander";
import { HookpipeClient } from "../client.js";

export const listenCommand = new Command("listen")
  .description("Stream webhook events with payloads for agent consumption")
  .option("--source <id>", "Filter by source ID")
  .option("--events <filter>", "Event type filter (comma-separated)", "*")
  .option("--consumer <name>", "Consumer name (resumes from last position)")
  .option("--interval <ms>", "Poll interval in milliseconds", "2000")
  .option("--limit <n>", "Stop after N events")
  .option("--timeout <dur>", "Stop after duration (e.g., 30s, 5m, 1h)")
  .option("--no-ack", "Disable auto-ack (events re-delivered on next listen)")
  .addHelpText("after", `
Events are streamed as NDJSON (one JSON object per line).
A consumer session tracks your position — restart and pick up
where you left off.

Examples:
  $ hookpipe listen --json | ./my-agent         # stream all events
  $ hookpipe listen --source src_stripe | jq .  # filter by source
  $ hookpipe listen --consumer my-bot           # named consumer (resumable)
  $ hookpipe listen --limit 10                  # process 10 events and stop
  $ hookpipe listen --timeout 5m               # stop after 5 minutes`)
  .action(async (opts) => {
    const client = new HookpipeClient();
    const interval = parseInt(opts.interval, 10);
    const maxEvents = opts.limit ? parseInt(opts.limit, 10) : Infinity;
    const timeoutMs = opts.timeout ? parseDuration(opts.timeout) : Infinity;
    const autoAck = opts.ack !== false;

    // 1. Create or resume consumer
    const consumerName = opts.consumer ?? `listen-${Date.now()}`;
    const eventTypes = opts.events === "*" ? ["*"] : opts.events.split(",");

    const consumerRes = await client.createConsumer({
      name: consumerName,
      source_id: opts.source,
      event_types: eventTypes,
    });

    const consumer = consumerRes.data as { id: string; name: string; last_acked_at: string | null };
    const consumerId = consumer.id;

    // Print startup info to stderr (stdout is reserved for NDJSON)
    const isResuming = consumer.last_acked_at !== null;
    process.stderr.write(
      `Consumer "${consumer.name}" ${isResuming ? "resumed" : "created"} (${consumerId})\n`,
    );
    if (isResuming) {
      process.stderr.write(`Resuming from: ${consumer.last_acked_at}\n`);
    }

    // 2. Poll loop
    let eventCount = 0;
    const startTime = Date.now();
    let running = true;

    const cleanup = () => {
      running = false;
      process.stderr.write(`\nStopped. ${eventCount} events consumed.\n`);
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    while (running) {
      if (eventCount >= maxEvents) break;
      if (Date.now() - startTime >= timeoutMs) break;

      try {
        const res = await client.pollConsumer(consumerId, { limit: 10 });
        const events = (res.data ?? []) as Array<Record<string, unknown>>;

        for (const evt of events) {
          if (eventCount >= maxEvents) break;

          // Parse payload if string
          let payload = evt.payload;
          if (typeof payload === "string") {
            try {
              payload = JSON.parse(payload);
            } catch {
              // keep as string
            }
          }

          const line = JSON.stringify({
            id: evt.id,
            source_id: evt.source_id,
            event_type: evt.event_type,
            received_at: evt.received_at,
            payload,
          });

          // Write with backpressure
          const canWrite = process.stdout.write(line + "\n");
          if (!canWrite) {
            await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
          }

          // Ack after successful write
          if (autoAck) {
            await client.ackConsumer(consumerId, { event_id: evt.id as string });
          }

          eventCount++;
        }

        // Adaptive polling
        const delay = events.length > 0 ? Math.max(500, interval / 2) : interval;
        await sleep(delay);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        process.stderr.write(`Error: ${msg}\n`);
        await sleep(interval * 2);
      }
    }

    cleanup();
  });

function parseDuration(dur: string): number {
  const match = dur.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: ${dur}. Use format like 30s, 5m, 1h`);
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 };
  return parseInt(num, 10) * multipliers[unit];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
