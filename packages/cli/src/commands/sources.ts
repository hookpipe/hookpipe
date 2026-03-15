import { Command } from "commander";
import { HookflareClient } from "../client.js";
import { output, outputTable, outputSuccess } from "../output.js";
import { parseJsonData } from "../input.js";

export const sourcesCommand = new Command("sources")
  .description("Manage webhook sources");

sourcesCommand
  .command("list")
  .alias("ls")
  .description("List all sources")
  .option("--fields <fields>", "Comma-separated fields to include in output")
  .action(async (opts) => {
    const client = new HookflareClient();
    const res = await client.listSources();
    const sources = res.data as Record<string, unknown>[];

    if (opts.fields) {
      const fields = opts.fields.split(",").map((f: string) => f.trim());
      outputTable(sources.map((s) => Object.fromEntries(fields.map((f: string) => [f, s[f]]))));
    } else {
      outputTable(
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          verification: s.verification_type ?? "none",
          created_at: s.created_at,
        })),
      );
    }
  });

sourcesCommand
  .command("get")
  .description("Get source details")
  .argument("<id>", "Source ID")
  .action(async (id: string) => {
    const client = new HookflareClient();
    const res = await client.getSource(id);
    output(res.data);
  });

sourcesCommand
  .command("create")
  .description("Create a new source")
  .option("--name <name>", "Source name")
  .option("--verification-type <type>", "Signature verification type (hmac-sha256, hmac-sha1)")
  .option("--verification-secret <secret>", "Shared secret for signature verification")
  .option("-d, --data <json>", "Raw JSON payload (agent-friendly, overrides flags)")
  .option("--dry-run", "Validate input without creating the resource")
  .addHelpText("after", `
Examples:
  # Human-friendly flags
  $ hookflare sources create --name stripe --verification-type hmac-sha256

  # Agent-friendly raw JSON
  $ hookflare sources create -d '{"name":"stripe","verification":{"type":"hmac-sha256","secret":"whsec_..."}}'

  # Dry run (validate only)
  $ hookflare sources create -d '{"name":"test"}' --dry-run`)
  .action(async (opts) => {
    const body = parseJsonData(opts.data) ?? {
      name: opts.name,
      ...(opts.verificationType
        ? { verification: { type: opts.verificationType, secret: opts.verificationSecret } }
        : {}),
    };

    if (!body.name) {
      throw new Error("name is required (use --name or -d '{\"name\":\"...\"}')");
    }

    if (opts.dryRun) {
      output({ dry_run: true, would_create: body });
      return;
    }

    const client = new HookflareClient();
    const res = await client.createSource(body as Parameters<HookflareClient["createSource"]>[0]);
    output(res.data);
    outputSuccess("Source created");
  });

sourcesCommand
  .command("delete")
  .alias("rm")
  .description("Delete a source")
  .argument("<id>", "Source ID")
  .option("--dry-run", "Show what would be deleted without deleting")
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      output({ dry_run: true, would_delete: { type: "source", id } });
      return;
    }
    const client = new HookflareClient();
    await client.deleteSource(id);
    outputSuccess(`Source ${id} deleted`);
  });
