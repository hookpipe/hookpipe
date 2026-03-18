import { Command } from "commander";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { builtinProviders } from "@hookpipe/providers";
import { ensureCloudflared, startTunnel } from "../cloudflared.js";

export const devCommand = new Command("dev")
  .description("Start a local development tunnel with provider signature verification")
  .requiredOption("--port <port>", "Local port to forward to")
  .option("--provider <name>", "Provider for signature verification (stripe, github, slack, ...)")
  .option("--secret <secret>", "Provider webhook signing secret")
  .option("--no-verify", "Disable signature verification")
  .addHelpText("after", `
Examples:
  # Forward webhooks to localhost:3000 with Stripe verification
  $ hookpipe dev --port 3000 --provider stripe --secret whsec_xxx

  # Forward without verification (any source)
  $ hookpipe dev --port 3000

  # GitHub webhooks
  $ hookpipe dev --port 3000 --provider github --secret ghsec_xxx

Paste the Webhook URL into your provider's dashboard.
Press Ctrl+C to stop.`)
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const provider = opts.provider as string | undefined;
    const secret = opts.secret as string | undefined;
    const verify = opts.verify !== false;

    if (verify && provider && !secret) {
      console.error("✗ --secret is required when --provider is set");
      process.exit(1);
    }

    // 1. Ensure cloudflared is available
    const cloudflaredPath = await ensureCloudflared();

    // 2. Start local proxy
    const proxyPort = await findFreePort(port + 1000);
    const stats = { received: 0, forwarded: 0, rejected: 0 };

    const proxy = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const body = await readBody(req);
      stats.received++;

      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      const method = req.method ?? "???";
      const url = req.url ?? "/";

      // Extract event type (best effort)
      let eventType = "unknown";
      try {
        const parsed = JSON.parse(body);
        eventType = parsed.type ?? parsed.event ?? parsed.action ?? "unknown";
      } catch {
        // not JSON
      }

      // Signature verification
      if (verify && provider && secret) {
        const isValid = await verifySignature(provider, secret, body, req.headers as Record<string, string>);
        if (!isValid) {
          stats.rejected++;
          console.log(`[${timestamp}] ${eventType}  ✗ sig rejected`);
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }
      }

      // Forward to local server
      try {
        const start = Date.now();
        const response = await fetch(`http://localhost:${port}${url}`, {
          method,
          headers: {
            "Content-Type": req.headers["content-type"] ?? "application/json",
            ...extractWebhookHeaders(req.headers),
          },
          body: method !== "GET" && method !== "HEAD" ? body : undefined,
        });

        const latency = Date.now() - start;
        stats.forwarded++;

        const statusIcon = response.ok ? "→" : "⚠";
        const sigLabel = verify && provider ? " ✓ sig " : " ";
        console.log(
          `[${timestamp}] ${eventType}${sigLabel}${statusIcon} localhost:${port} (${response.status}, ${latency}ms)`,
        );

        res.writeHead(response.status);
        const resBody = await response.text();
        res.end(resBody);
      } catch (err) {
        stats.forwarded++;
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.log(`[${timestamp}] ${eventType}  ✗ localhost:${port} (${errMsg})`);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to forward: ${errMsg}` }));
      }
    });

    proxy.listen(proxyPort);

    // 3. Start tunnel
    console.log("Starting tunnel...");
    const { process: tunnelProcess, urlPromise } = startTunnel(cloudflaredPath, proxyPort);
    let tunnelUrl: string;

    try {
      tunnelUrl = await urlPromise;
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : "Tunnel failed to start"}`);
      proxy.close();
      process.exit(1);
    }

    // 4. Display info
    console.log("");
    console.log(`✓ Tunnel established`);
    if (provider) {
      console.log(`✓ ${provider} signature verification: ${verify ? "enabled" : "disabled"}`);
    }
    console.log("");
    console.log(`  Webhook URL:  ${tunnelUrl}`);
    console.log(`  Forwarding:   → http://localhost:${port}`);
    console.log("");
    console.log("  Paste the Webhook URL into your provider's dashboard.");
    console.log("  Press Ctrl+C to stop.");
    console.log("");

    // 5. Graceful shutdown
    const cleanup = () => {
      console.log("");
      console.log(`✓ Stopped. ${stats.received} received, ${stats.forwarded} forwarded, ${stats.rejected} rejected.`);
      tunnelProcess.kill();
      proxy.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function findFreePort(start: number): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(start, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : start;
      server.close(() => resolve(port));
    });
    server.on("error", () => resolve(findFreePort(start + 1)));
  });
}

function extractWebhookHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      key.startsWith("x-") ||
      key === "stripe-signature" ||
      key === "user-agent"
    ) {
      result[key] = String(value);
    }
  }
  return result;
}

async function verifySignature(
  provider: string,
  secret: string,
  body: string,
  headers: Record<string, string>,
): Promise<boolean> {
  try {
    const providerDef = builtinProviders[provider];
    if (!providerDef) return true; // unknown provider, skip verification

    const verification = providerDef.verification;

    // Custom verification — not supported in dev mode
    if ("type" in verification && verification.type === "custom") return true;

    const sigHeader = verification.header;
    if (!headers[sigHeader]) return false;

    // Built-in verifiers with custom logic
    if ("type" in verification && verification.type === "stripe-signature") {
      return verifyStripe(secret, body, headers[sigHeader]);
    }

    // Generic HMAC verification using provider config
    const { createHmac } = await import("node:crypto");
    const algo = "algorithm" in verification && verification.algorithm === "hmac-sha1" ? "sha1" : "sha256";
    const encoding = "encoding" in verification ? (verification.encoding ?? "hex") : "hex";
    const expected = createHmac(algo, secret).update(body).digest(encoding as "hex" | "base64");
    const signature = headers[sigHeader].replace(/^(sha256|v0)=/, "");
    return expected === signature;
  } catch {
    return false;
  }
}

async function verifyStripe(secret: string, body: string, header: string): Promise<boolean> {
  const { createHmac } = await import("node:crypto");

  const parts = header.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  if (!tPart) return false;
  const timestamp = tPart.slice(2);

  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");

  return signatures.some((sig) => sig === expected);
}
