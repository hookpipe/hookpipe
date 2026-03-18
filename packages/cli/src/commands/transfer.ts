import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { HookpipeClient } from "../client.js";
import { output, outputSuccess, outputError } from "../output.js";

export const exportCommand = new Command("export")
  .description("Export all configuration (sources, destinations, subscriptions)")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .addHelpText("after", `
Examples:
  $ hookpipe export                          # print JSON to stdout
  $ hookpipe export -o backup.json           # save to file
  $ hookpipe export | hookpipe import \\
      --target https://other.instance.com     # pipe to another instance`)
  .action(async (opts) => {
    const client = new HookpipeClient();
    const res = await client.exportConfig();

    if (opts.output) {
      writeFileSync(opts.output, JSON.stringify(res.data, null, 2) + "\n");
      outputSuccess(`Exported to ${opts.output}`);
    } else {
      // Write raw JSON to stdout (pipe-friendly)
      console.log(JSON.stringify(res.data, null, 2));
    }
  });

export const importCommand = new Command("import")
  .description("Import configuration from a JSON file or stdin")
  .option("-f, --file <file>", "Read from file")
  .option("--target <url>", "Target instance URL (overrides configured api_url)")
  .option("--target-key <key>", "Target instance API key")
  .addHelpText("after", `
Examples:
  $ hookpipe import -f backup.json           # import from file
  $ cat backup.json | hookpipe import        # import from stdin
  $ hookpipe import -f backup.json \\
      --target https://acme.hookpipe.dev \\
      --target-key hf_sk_xxx                  # import to a different instance

Behavior:
  - Existing resources (matched by name) are skipped, not overwritten
  - Subscription IDs are re-linked to the new source/destination IDs
  - API keys are NOT imported — create new keys on the target instance`)
  .action(async (opts) => {
    let raw: string;

    if (opts.file) {
      raw = readFileSync(opts.file, "utf-8");
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString("utf-8");
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      outputError("Invalid JSON input");
      process.exit(1);
    }

    const clientOpts: { apiUrl?: string; token?: string } = {};
    if (opts.target) clientOpts.apiUrl = opts.target;
    if (opts.targetKey) clientOpts.token = opts.targetKey;

    const client = new HookpipeClient(clientOpts);
    const res = await client.importConfig(data);
    const result = res.data as {
      sources: { created: number; skipped: number };
      destinations: { created: number; skipped: number };
      subscriptions: { created: number; skipped: number };
    };

    output(result);
    outputSuccess(
      `Imported: ${result.sources.created} sources, ${result.destinations.created} destinations, ${result.subscriptions.created} subscriptions`,
    );
  });

export const migrateCommand = new Command("migrate")
  .description("Migrate configuration between hookpipe instances")
  .requiredOption("--from <url>", "Source instance URL")
  .requiredOption("--from-key <key>", "Source instance API key")
  .requiredOption("--to <url>", "Target instance URL")
  .requiredOption("--to-key <key>", "Target instance API key")
  .addHelpText("after", `
Examples:
  # Self-hosted → hookpipe managed
  $ hookpipe migrate \\
      --from http://localhost:8787 --from-key hf_sk_old \\
      --to https://acme.hookpipe.dev --to-key hf_sk_new

  # hookpipe managed → self-hosted (reverse migration)
  $ hookpipe migrate \\
      --from https://acme.hookpipe.dev --from-key hf_sk_old \\
      --to http://my-server.com --to-key hf_sk_new`)
  .action(async (opts) => {
    // 1. Export from source
    const sourceClient = new HookpipeClient({
      apiUrl: opts.from,
      token: opts.fromKey,
    });

    outputSuccess(`Exporting from ${opts.from}...`);
    const exportRes = await sourceClient.exportConfig();
    const exportData = exportRes.data;

    // 2. Import to target
    const targetClient = new HookpipeClient({
      apiUrl: opts.to,
      token: opts.toKey,
    });

    outputSuccess(`Importing to ${opts.to}...`);
    const importRes = await targetClient.importConfig(exportData);
    const result = importRes.data as {
      sources: { created: number; skipped: number };
      destinations: { created: number; skipped: number };
      subscriptions: { created: number; skipped: number };
    };

    output(result);
    outputSuccess("Migration complete");
  });
