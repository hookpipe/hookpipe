import { Command } from "commander";
import { HookflareClient } from "../client.js";
import { output, outputTable, outputSuccess } from "../output.js";
import { tailCommand } from "./tail.js";

export const eventsCommand = new Command("events")
  .description("View webhook events and deliveries");

eventsCommand
  .command("list")
  .alias("ls")
  .description("List received events")
  .option("--source <id>", "Filter by source ID")
  .option("--limit <n>", "Max results", "20")
  .action(async (opts) => {
    const client = new HookflareClient();
    const res = await client.listEvents({
      source_id: opts.source,
      limit: parseInt(opts.limit, 10),
    });
    const events = res.data as Record<string, unknown>[];
    outputTable(
      events.map((e) => ({
        id: e.id,
        source_id: e.source_id,
        event_type: e.event_type ?? "-",
        received_at: e.received_at,
      })),
    );
  });

eventsCommand
  .command("get")
  .description("Get event details with payload")
  .argument("<id>", "Event ID")
  .action(async (id: string) => {
    const client = new HookflareClient();
    const res = await client.getEvent(id);
    output(res.data);
  });

eventsCommand
  .command("deliveries")
  .description("List delivery attempts for an event")
  .argument("<event_id>", "Event ID")
  .action(async (eventId: string) => {
    const client = new HookflareClient();
    const res = await client.getEventDeliveries(eventId);
    const deliveries = res.data as Record<string, unknown>[];
    outputTable(
      deliveries.map((d) => ({
        id: d.id,
        destination_id: d.destination_id,
        status: d.status,
        attempt: d.attempt,
        status_code: d.status_code ?? "-",
        latency_ms: d.latency_ms ?? "-",
      })),
    );
  });

// Alias: `hookflare events tail` → same as `hookflare tail`
eventsCommand.addCommand(tailCommand);

eventsCommand
  .command("replay")
  .description("Replay an event to its destinations")
  .argument("<id>", "Event ID")
  .action(async (id: string) => {
    const client = new HookflareClient();
    await client.replayEvent(id);
    outputSuccess(`Event ${id} replayed`);
  });
