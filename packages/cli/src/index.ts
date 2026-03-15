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
  .version("0.0.1")
  .option("--json", "Output in JSON format (agent-friendly)")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.json) setJsonMode(true);
  });

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
            name: { type: "string", required: true },
            verification: {
              type: "object",
              required: false,
              fields: {
                type: { type: "string", enum: ["hmac-sha256", "hmac-sha1"] },
                secret: { type: "string" },
              },
            },
          },
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
            name: { type: "string", required: true },
            url: { type: "string", required: true },
            retry_policy: {
              type: "object",
              required: false,
              fields: {
                max_retries: { type: "integer", default: 5 },
                timeout_ms: { type: "integer", default: 30000 },
                backoff_base_ms: { type: "integer", default: 30000 },
                backoff_max_ms: { type: "integer", default: 86400000 },
              },
            },
          },
        },
        read: { method: "GET", path: "/api/v1/destinations/:id" },
        list: { method: "GET", path: "/api/v1/destinations" },
        update: { method: "PUT", path: "/api/v1/destinations/:id" },
        delete: { method: "DELETE", path: "/api/v1/destinations/:id" },
      },
      subscriptions: {
        resource: "subscriptions",
        create: {
          method: "POST",
          path: "/api/v1/subscriptions",
          fields: {
            source_id: { type: "string", required: true },
            destination_id: { type: "string", required: true },
            event_types: { type: "string[]", default: ["*"] },
          },
        },
        list: { method: "GET", path: "/api/v1/subscriptions" },
        delete: { method: "DELETE", path: "/api/v1/subscriptions/:id" },
      },
      events: {
        resource: "events",
        read: { method: "GET", path: "/api/v1/events/:id" },
        list: { method: "GET", path: "/api/v1/events", query: { source_id: "string", limit: "integer", offset: "integer" } },
        deliveries: { method: "GET", path: "/api/v1/events/:id/deliveries" },
        replay: { method: "POST", path: "/api/v1/events/:id/replay" },
      },
      keys: {
        resource: "keys",
        create: {
          method: "POST",
          path: "/api/v1/keys",
          fields: {
            name: { type: "string", required: true },
            scopes: { type: "string[]", default: ["admin"] },
            expires_at: { type: "string", required: false },
          },
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
