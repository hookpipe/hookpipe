import { Command } from "commander";
import { HookpipeClient } from "../client.js";
import { isJsonMode } from "../output.js";

interface TailEvent {
  type: "event" | "delivery";
  id: string;
  at: string;
  // event fields
  source_id?: string;
  event_type?: string;
  payload?: unknown;
  // delivery fields
  event_id?: string;
  destination_id?: string;
  status?: string;
  status_code?: number | null;
  latency_ms?: number | null;
  attempt?: number;
}

export const tailCommand = new Command("tail")
  .description("Stream incoming events and delivery results in real-time")
  .option("--source <id>", "Filter by source ID")
  .option("--interval <ms>", "Poll interval in milliseconds", "2000")
  .option("--limit <n>", "Stop after N events")
  .option("--timeout <dur>", "Stop after duration (e.g., 30s, 5m, 1h)")
  .option("--payload", "Include full event payload in output")
  .option("--json", "NDJSON output (one JSON object per line)")
  .addHelpText("after", `
Examples:
  $ hookpipe tail                              # stream all events
  $ hookpipe tail --source src_xxx             # filter by source
  $ hookpipe tail --json | ./my-agent          # pipe to agent process
  $ hookpipe tail --payload --json | jq .      # stream with full payloads
  $ hookpipe tail --limit 10                   # stop after 10 events
  $ hookpipe tail --timeout 5m                 # stop after 5 minutes`)
  .action(async (opts) => {
    const client = new HookpipeClient();
    const jsonMode = opts.json || isJsonMode();
    const interval = parseInt(opts.interval, 10);
    const maxEvents = opts.limit ? parseInt(opts.limit, 10) : Infinity;
    const timeoutMs = opts.timeout ? parseDuration(opts.timeout) : Infinity;

    let lastEventTime = new Date().toISOString();
    let lastDeliveryTime = lastEventTime;
    let eventCount = 0;
    const startTime = Date.now();
    let running = true;

    if (!jsonMode) {
      console.log("Tailing events... (Ctrl+C to stop)\n");
    }

    const cleanup = () => {
      running = false;
      if (!jsonMode) {
        console.log(`\n✓ Stopped. ${eventCount} events received.`);
      }
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    while (running) {
      // Check limits
      if (eventCount >= maxEvents) break;
      if (Date.now() - startTime >= timeoutMs) break;

      try {
        // Fetch new events
        const eventsRes = await client.listEvents({
          source_id: opts.source,
          after: lastEventTime,
          limit: opts.payload ? 10 : 50,
          include_payload: opts.payload ?? false,
        });
        const events = (eventsRes.data ?? []) as Record<string, unknown>[];

        // Fetch new deliveries
        const deliveriesRes = await client.listDeliveries({
          after: lastDeliveryTime,
          limit: 50,
        });
        const deliveries = (deliveriesRes.data ?? []) as Record<string, unknown>[];

        // Merge and sort
        const items: TailEvent[] = [];

        for (const e of events) {
          const item: TailEvent = {
            type: "event",
            id: e.id as string,
            at: e.received_at as string,
            source_id: e.source_id as string,
            event_type: (e.event_type as string) ?? "unknown",
          };
          if (opts.payload && e.payload !== undefined) {
            try {
              item.payload = typeof e.payload === "string" ? JSON.parse(e.payload as string) : e.payload;
            } catch {
              item.payload = e.payload;
            }
          }
          items.push(item);
          lastEventTime = e.received_at as string;
          eventCount++;
        }

        for (const d of deliveries) {
          items.push({
            type: "delivery",
            id: d.id as string,
            at: d.updated_at as string,
            event_id: d.event_id as string,
            destination_id: d.destination_id as string,
            status: d.status as string,
            status_code: d.status_code as number | null,
            latency_ms: d.latency_ms as number | null,
            attempt: d.attempt as number,
          });
          lastDeliveryTime = d.updated_at as string;
        }

        items.sort((a, b) => a.at.localeCompare(b.at));

        // Output
        for (const item of items) {
          if (jsonMode) {
            console.log(JSON.stringify(item));
          } else {
            console.log(formatLine(item));
          }
        }

        // Adaptive polling: faster when active, slower when idle
        const delay = items.length > 0 ? Math.max(500, interval / 2) : interval;
        await sleep(delay);
      } catch (err) {
        if (!jsonMode) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`  ✗ ${msg}`);
        }
        await sleep(interval * 2);
      }
    }

    cleanup();
  });

function formatLine(item: TailEvent): string {
  const time = item.at.split("T")[1]?.slice(0, 8) ?? "";

  if (item.type === "event") {
    let line = `[${time}] ${item.id} ← ${item.source_id}  ${item.event_type}`;
    if (item.payload) {
      const preview = JSON.stringify(item.payload);
      line += `\n         ${preview.length > 200 ? preview.slice(0, 200) + "..." : preview}`;
    }
    return line;
  }

  const statusIcon = item.status === "success" ? "✓" : item.status === "dlq" ? "✗✗" : "✗";
  const code = item.status_code ? ` ${item.status_code}` : "";
  const latency = item.latency_ms ? ` (${item.latency_ms}ms)` : "";
  const attempt = (item.attempt ?? 0) > 1 ? ` attempt ${item.attempt}` : "";
  return `[${time}] ${item.event_id} → ${item.destination_id}  ${statusIcon}${code}${latency}${attempt}`;
}

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
