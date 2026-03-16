import { Command } from "commander";
import { setJsonMode, outputError } from "./output.js";
import { configCommand } from "./commands/config.js";
import { sourcesCommand } from "./commands/sources.js";
import { destinationsCommand } from "./commands/destinations.js";
import { subscriptionsCommand } from "./commands/subscriptions.js";
import { eventsCommand } from "./commands/events.js";
import { exportCommand, importCommand, migrateCommand } from "./commands/transfer.js";
import { HookflareClient } from "./client.js";

const program = new Command();

program
  .name("hookflare")
  .description("CLI for hookflare — open-source webhook infrastructure")
  .version("0.0.2")
  .option("--json", "Output in JSON format (agent-friendly)")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.json) setJsonMode(true);
  })
  .addHelpText("after", `
Agent-Friendly Features:
  --json              Structured JSON output on all commands
  -d, --data <json>   Raw JSON input on create commands (skips flag mapping)
  --dry-run           Validate mutations without executing
  --fields            Limit list output to specific columns
  schema [resource]   Discover API resources and fields at runtime

Getting started (agent):
  $ hookflare schema                            # discover all resources
  $ hookflare schema sources                    # inspect source fields
  $ hookflare health --json                     # check connectivity

See AGENTS.md for the full agent guide.`);

// Health check
program
  .command("health")
  .description("Check connection to hookflare server")
  .action(async () => {
    const client = new HookflareClient();
    const res = await client.health();
    console.log(JSON.stringify(res, null, 2));
  });

// Schema introspection (agent-friendly: query CLI capabilities at runtime)
program
  .command("schema")
  .description("Show API resource schemas (agent-friendly introspection)")
  .argument("[resource]", "Resource name: sources, destinations, subscriptions, events, keys")
  .action(async (resource?: string) => {
    const schemas: Record<string, object> = {
      sources: {
        resource: "sources",
        create: {
          method: "POST",
          path: "/api/v1/sources",
          fields: {
            name: { type: "string", required: true, example: "stripe" },
            verification: {
              type: "object",
              required: false,
              fields: {
                type: { type: "string", enum: ["stripe", "hmac-sha256", "hmac-sha1"], example: "stripe" },
                secret: { type: "string", example: "whsec_..." },
              },
            },
          },
          example: { name: "stripe", verification: { type: "stripe", secret: "whsec_..." } },
        },
        read: { method: "GET", path: "/api/v1/sources/:id" },
        list: { method: "GET", path: "/api/v1/sources" },
        update: { method: "PUT", path: "/api/v1/sources/:id" },
        delete: { method: "DELETE", path: "/api/v1/sources/:id" },
      },
      destinations: {
        resource: "destinations",
        create: {
          method: "POST",
          path: "/api/v1/destinations",
          fields: {
            name: { type: "string", required: true, example: "my-api" },
            url: { type: "string", required: true, example: "https://api.example.com/webhooks" },
            retry_policy: {
              type: "object",
              required: false,
              fields: {
                strategy: { type: "string", enum: ["exponential", "linear", "fixed"], default: "exponential" },
                max_retries: { type: "integer", default: 10, example: 10 },
                interval_ms: { type: "integer", default: 60000, description: "Base interval in ms" },
                max_interval_ms: { type: "integer", default: 86400000, description: "Max interval cap in ms" },
                timeout_ms: { type: "integer", default: 30000 },
                on_status: { type: "string[]", description: "Status codes to retry", example: ["5xx", "429"] },
              },
            },
          },
          example: { name: "my-api", url: "https://api.example.com/webhooks", retry_policy: { strategy: "exponential", max_retries: 10 } },
        },
        read: { method: "GET", path: "/api/v1/destinations/:id" },
        list: { method: "GET", path: "/api/v1/destinations" },
        update: { method: "PUT", path: "/api/v1/destinations/:id" },
        delete: { method: "DELETE", path: "/api/v1/destinations/:id" },
        circuit: { method: "GET", path: "/api/v1/destinations/:id/circuit", description: "Circuit breaker state" },
        failed: { method: "GET", path: "/api/v1/destinations/:id/failed", description: "List failed deliveries (DLQ)" },
        replay_failed: { method: "POST", path: "/api/v1/destinations/:id/replay-failed", description: "Re-enqueue all DLQ events" },
      },
      subscriptions: {
        resource: "subscriptions",
        create: {
          method: "POST",
          path: "/api/v1/subscriptions",
          fields: {
            source_id: { type: "string", required: true, example: "src_xxx" },
            destination_id: { type: "string", required: true, example: "dst_yyy" },
            event_types: { type: "string[]", default: ["*"], example: ["payment_intent.*", "charge.*"] },
          },
          example: { source_id: "src_xxx", destination_id: "dst_yyy", event_types: ["payment_intent.*"] },
        },
        list: { method: "GET", path: "/api/v1/subscriptions" },
        delete: { method: "DELETE", path: "/api/v1/subscriptions/:id" },
      },
      events: {
        resource: "events",
        read: { method: "GET", path: "/api/v1/events/:id", description: "Get event with payload" },
        list: { method: "GET", path: "/api/v1/events", query: { source_id: "string", limit: "integer (default 50)", offset: "integer" } },
        deliveries: { method: "GET", path: "/api/v1/events/:id/deliveries", description: "List delivery attempts" },
        replay: { method: "POST", path: "/api/v1/events/:id/replay", description: "Re-enqueue event for delivery" },
      },
      keys: {
        resource: "keys",
        create: {
          method: "POST",
          path: "/api/v1/keys",
          fields: {
            name: { type: "string", required: true, example: "my-agent" },
            scopes: { type: "string[]", default: ["admin"], example: ["admin"] },
            expires_at: { type: "string (ISO 8601)", required: false, example: "2026-12-31T23:59:59Z" },
          },
          example: { name: "my-agent", scopes: ["admin"] },
        },
        list: { method: "GET", path: "/api/v1/keys" },
        revoke: { method: "DELETE", path: "/api/v1/keys/:id" },
      },
    };

    if (resource) {
      const schema = schemas[resource];
      if (!schema) {
        throw new Error(`Unknown resource: ${resource}. Available: ${Object.keys(schemas).join(", ")}`);
      }
      console.log(JSON.stringify(schema, null, 2));
    } else {
      console.log(JSON.stringify({ resources: Object.keys(schemas), schemas }, null, 2));
    }
  });

// Register subcommands
program.addCommand(configCommand);
program.addCommand(sourcesCommand);
program.addCommand(destinationsCommand);
program.addCommand(subscriptionsCommand);
program.addCommand(eventsCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(migrateCommand);

// Global error handler
program.exitOverride();

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error && err.message !== "(outputHelp)") {
      outputError(err.message);
      process.exit(1);
    }
  }
}

main();
