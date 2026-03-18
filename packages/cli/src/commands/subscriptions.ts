import { Command } from "commander";
import { HookpipeClient } from "../client.js";
import { output, outputTable, outputSuccess } from "../output.js";
import { parseJsonData } from "../input.js";

export const subscriptionsCommand = new Command("subscriptions")
  .alias("subs")
  .description("Manage webhook subscriptions (source → destination routing)");

subscriptionsCommand
  .command("list")
  .alias("ls")
  .description("List all subscriptions")
  .action(async () => {
    const client = new HookpipeClient();
    const res = await client.listSubscriptions();
    const subs = res.data as Record<string, unknown>[];
    outputTable(
      subs.map((s) => ({
        id: s.id,
        source_id: s.source_id,
        destination_id: s.destination_id,
        event_types: s.event_types,
        enabled: s.enabled,
      })),
    );
  });

subscriptionsCommand
  .command("create")
  .description("Create a new subscription")
  .option("--source <id>", "Source ID")
  .option("--destination <id>", "Destination ID")
  .option("--events <types...>", "Event type filters (default: *)")
  .option("-d, --data <json>", "Raw JSON payload (agent-friendly, overrides flags)")
  .option("--dry-run", "Validate input without creating the resource")
  .addHelpText("after", `
Examples:
  $ hookpipe subs create --source src_xxx --destination dst_yyy
  $ hookpipe subs create -d '{"source_id":"src_xxx","destination_id":"dst_yyy","event_types":["payment.*"]}'`)
  .action(async (opts) => {
    const body = parseJsonData(opts.data) ?? {
      source_id: opts.source,
      destination_id: opts.destination,
      event_types: opts.events ?? ["*"],
    };

    if (!body.source_id) throw new Error("source_id is required");
    if (!body.destination_id) throw new Error("destination_id is required");

    if (opts.dryRun) {
      output({ dry_run: true, would_create: body });
      return;
    }

    const client = new HookpipeClient();
    const res = await client.createSubscription(body as Parameters<HookpipeClient["createSubscription"]>[0]);
    output(res.data);
    outputSuccess("Subscription created");
  });

subscriptionsCommand
  .command("delete")
  .alias("rm")
  .description("Delete a subscription")
  .argument("<id>", "Subscription ID")
  .option("--dry-run", "Show what would be deleted without deleting")
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      output({ dry_run: true, would_delete: { type: "subscription", id } });
      return;
    }
    const client = new HookpipeClient();
    await client.deleteSubscription(id);
    outputSuccess(`Subscription ${id} deleted`);
  });
