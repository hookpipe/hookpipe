/**
 * MCP (Model Context Protocol) server for hookpipe.
 *
 * Implements JSON-RPC 2.0 over stdio with 2 tools:
 * - hookpipe_schema: discover resources and API shapes
 * - hookpipe_execute: execute hookpipe operations
 *
 * Usage: hookpipe mcp
 * Transport: stdio (standard MCP)
 *
 * No external MCP SDK — the protocol surface is small enough
 * to implement directly (~150 lines).
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import { HookpipeClient } from "../client.js";
import { builtinProviders } from "@hookpipe/providers";

// --- JSON-RPC types ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "hookpipe_schema",
    description:
      "Discover hookpipe resources, their fields, and available operations. " +
      "Call without arguments for an overview, or pass a resource name for details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource: {
          type: "string",
          enum: ["sources", "destinations", "subscriptions", "events", "keys", "providers"],
          description: "Resource to inspect. Omit for overview.",
        },
      },
    },
  },
  {
    name: "hookpipe_execute",
    description:
      "Execute a hookpipe operation. Use hookpipe_schema first to discover available operations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Operation: health, sources.list, sources.get, sources.create, sources.delete, " +
            "destinations.list, destinations.get, destinations.create, destinations.delete, " +
            "subscriptions.list, subscriptions.create, subscriptions.delete, " +
            "events.list, events.get, events.replay, " +
            "providers.list, providers.describe",
        },
        args: {
          type: "object",
          description: "Operation arguments (e.g., {id: 'src_xxx'} for .get, or create body)",
        },
      },
      required: ["command"],
    },
  },
];

// --- Command dispatch ---

type CommandHandler = (
  client: HookpipeClient,
  args: Record<string, unknown>,
) => Promise<unknown>;

const COMMANDS: Record<string, CommandHandler> = {
  "health": (c) => c.health(),
  "sources.list": (c) => c.listSources(),
  "sources.get": (c, a) => c.getSource(a.id as string),
  "sources.create": (c, a) => c.createSource(a as Parameters<HookpipeClient["createSource"]>[0]),
  "sources.delete": (c, a) => c.deleteSource(a.id as string),
  "destinations.list": (c) => c.listDestinations(),
  "destinations.get": (c, a) => c.getDestination(a.id as string),
  "destinations.create": (c, a) =>
    c.createDestination(a as Parameters<HookpipeClient["createDestination"]>[0]),
  "destinations.delete": (c, a) => c.deleteDestination(a.id as string),
  "subscriptions.list": (c) => c.listSubscriptions(),
  "subscriptions.create": (c, a) =>
    c.createSubscription(a as Parameters<HookpipeClient["createSubscription"]>[0]),
  "subscriptions.delete": (c, a) => c.deleteSubscription(a.id as string),
  "events.list": (c, a) => c.listEvents(a as Parameters<HookpipeClient["listEvents"]>[0]),
  "events.get": (c, a) => c.getEvent(a.id as string),
  "events.replay": (c, a) => c.replayEvent(a.id as string),
  "providers.list": async () => {
    return Object.entries(builtinProviders).map(([id, p]) => ({
      id,
      name: p.name,
      events: Object.keys(p.events).length,
      verification: p.verification,
    }));
  },
  "providers.describe": async (_c, a) => {
    const id = a.id as string;
    const p = builtinProviders[id];
    if (!p) return { error: `Unknown provider: ${id}` };
    return {
      id: p.id,
      name: p.name,
      website: p.website,
      verification: p.verification,
      events: Object.entries(p.events).map(([name, def]) => ({
        name,
        description: typeof def === "string" ? def : def.description,
        category: typeof def === "string" ? undefined : def.category,
      })),
      presets: p.presets,
      nextSteps: p.nextSteps,
    };
  },
};

// --- Schema data ---

function getSchemaData(resource?: string): unknown {
  const resources = ["sources", "destinations", "subscriptions", "events", "keys", "providers"];

  if (!resource) {
    return {
      resources,
      description:
        "hookpipe — open-source webhook infrastructure. " +
        "Use hookpipe_schema with a resource name for details, " +
        "then hookpipe_execute to perform operations.",
      operations: Object.keys(COMMANDS),
    };
  }

  const schemas: Record<string, unknown> = {
    sources: {
      operations: ["sources.list", "sources.get", "sources.create", "sources.delete"],
      create_args: { name: "string (required)", provider: "string", verification: "{ type, secret }" },
      id_format: "src_<hex>",
    },
    destinations: {
      operations: ["destinations.list", "destinations.get", "destinations.create", "destinations.delete"],
      create_args: { name: "string (required)", url: "string (required)", retry_policy: "{ strategy, max_retries, ... }" },
      id_format: "dst_<hex>",
    },
    subscriptions: {
      operations: ["subscriptions.list", "subscriptions.create", "subscriptions.delete"],
      create_args: { source_id: "string (required)", destination_id: "string (required)", event_types: "string[] (default [\"*\"])" },
      id_format: "sub_<hex>",
    },
    events: {
      operations: ["events.list", "events.get", "events.replay"],
      list_args: { source_id: "string", after: "ISO timestamp", limit: "number", include_payload: "boolean" },
      id_format: "evt_<hex>",
    },
    keys: {
      operations: ["keys.create (via bootstrap)", "keys.list", "keys.revoke"],
      id_format: "key_<hex>",
    },
    providers: {
      operations: ["providers.list", "providers.describe"],
      describe_args: { id: "string (e.g. 'stripe', 'github')" },
      builtin: Object.keys(builtinProviders),
    },
  };

  return schemas[resource] ?? { error: `Unknown resource: ${resource}` };
}

// --- JSON-RPC handler ---

function handleRequest(client: HookpipeClient, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const respond = (result: unknown): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id: req.id ?? null,
    result,
  });

  const respondError = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id: req.id ?? null,
    error: { code, message },
  });

  switch (req.method) {
    case "initialize":
      return Promise.resolve(
        respond({
          protocolVersion: "2024-11-05",
          serverInfo: { name: "hookpipe", version: "0.1.0" },
          capabilities: { tools: {} },
        }),
      );

    case "notifications/initialized":
      // Client ack — no response needed for notifications
      return Promise.resolve(respond(null));

    case "tools/list":
      return Promise.resolve(respond({ tools: TOOLS }));

    case "tools/call": {
      const toolName = (req.params?.name ?? "") as string;
      const toolArgs = (req.params?.arguments ?? {}) as Record<string, unknown>;

      if (toolName === "hookpipe_schema") {
        const data = getSchemaData(toolArgs.resource as string | undefined);
        return Promise.resolve(
          respond({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }),
        );
      }

      if (toolName === "hookpipe_execute") {
        const cmd = toolArgs.command as string;
        const args = (toolArgs.args ?? {}) as Record<string, unknown>;
        const handler = COMMANDS[cmd];
        if (!handler) {
          return Promise.resolve(
            respond({
              content: [{ type: "text", text: JSON.stringify({ error: `Unknown command: ${cmd}`, available: Object.keys(COMMANDS) }) }],
              isError: true,
            }),
          );
        }
        return handler(client, args)
          .then((result) =>
            respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }),
          )
          .catch((err: Error) =>
            respond({
              content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
              isError: true,
            }),
          );
      }

      return Promise.resolve(respondError(-32601, `Unknown tool: ${toolName}`));
    }

    default:
      return Promise.resolve(respondError(-32601, `Method not found: ${req.method}`));
  }
}

// --- Main loop ---

async function runMcpServer(): Promise<void> {
  const client = new HookpipeClient();
  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const req = JSON.parse(line) as JsonRpcRequest;

      // Notifications have no id — don't send a response
      if (req.id === undefined && req.method.startsWith("notifications/")) {
        await handleRequest(client, req);
        continue;
      }

      const res = await handleRequest(client, req);
      process.stdout.write(JSON.stringify(res) + "\n");
    } catch {
      const errorRes: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(JSON.stringify(errorRes) + "\n");
    }
  }
}

export const mcpCommand = new Command("mcp")
  .description("Start MCP (Model Context Protocol) server over stdio")
  .addHelpText("after", `
The MCP server exposes 2 tools for LLM interaction:
  hookpipe_schema   — discover resources and API shapes
  hookpipe_execute  — execute hookpipe operations

Transport: stdio (JSON-RPC 2.0, one JSON object per line)

Example MCP client config:
  {
    "mcpServers": {
      "hookpipe": { "command": "hookpipe", "args": ["mcp"] }
    }
  }`)
  .action(runMcpServer);
