import { Command } from "commander";
import { HookpipeClient } from "../client.js";
import { output, outputTable, outputSuccess } from "../output.js";
import { parseJsonData } from "../input.js";

export const destinationsCommand = new Command("destinations")
  .alias("dest")
  .description("Manage webhook destinations");

destinationsCommand
  .command("list")
  .alias("ls")
  .description("List all destinations")
  .option("--fields <fields>", "Comma-separated fields to include in output")
  .action(async (opts) => {
    const client = new HookpipeClient();
    const res = await client.listDestinations();
    const dests = res.data as Record<string, unknown>[];

    if (opts.fields) {
      const fields = opts.fields.split(",").map((f: string) => f.trim());
      outputTable(dests.map((d) => Object.fromEntries(fields.map((f: string) => [f, d[f]]))));
    } else {
      outputTable(
        dests.map((d) => ({
          id: d.id,
          name: d.name,
          url: d.url,
          max_retries: d.max_retries,
          created_at: d.created_at,
        })),
      );
    }
  });

destinationsCommand
  .command("get")
  .description("Get destination details")
  .argument("<id>", "Destination ID")
  .action(async (id: string) => {
    const client = new HookpipeClient();
    const res = await client.getDestination(id);
    output(res.data);
  });

destinationsCommand
  .command("create")
  .description("Create a new destination")
  .option("--name <name>", "Destination name")
  .option("--url <url>", "Target URL")
  .option("--max-retries <n>", "Maximum retry attempts", "5")
  .option("--timeout-ms <n>", "Request timeout in ms", "30000")
  .option("-d, --data <json>", "Raw JSON payload (agent-friendly, overrides flags)")
  .option("--dry-run", "Validate input without creating the resource")
  .addHelpText("after", `
Examples:
  $ hookpipe dest create --name my-app --url https://api.example.com/hooks
  $ hookpipe dest create -d '{"name":"my-app","url":"https://api.example.com/hooks","retry_policy":{"max_retries":3}}'
  $ hookpipe dest create -d '{"name":"test","url":"https://test.com"}' --dry-run`)
  .action(async (opts) => {
    const body = parseJsonData(opts.data) ?? {
      name: opts.name,
      url: opts.url,
      retry_policy: {
        max_retries: parseInt(opts.maxRetries, 10),
        timeout_ms: parseInt(opts.timeoutMs, 10),
      },
    };

    if (!body.name) throw new Error("name is required");
    if (!body.url) throw new Error("url is required");

    if (opts.dryRun) {
      output({ dry_run: true, would_create: body });
      return;
    }

    const client = new HookpipeClient();
    const res = await client.createDestination(body as Parameters<HookpipeClient["createDestination"]>[0]);
    output(res.data);
    outputSuccess("Destination created");
  });

destinationsCommand
  .command("delete")
  .alias("rm")
  .description("Delete a destination")
  .argument("<id>", "Destination ID")
  .option("--dry-run", "Show what would be deleted without deleting")
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      output({ dry_run: true, would_delete: { type: "destination", id } });
      return;
    }
    const client = new HookpipeClient();
    await client.deleteDestination(id);
    outputSuccess(`Destination ${id} deleted`);
  });
