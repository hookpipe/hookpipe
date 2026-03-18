import { Command } from "commander";
import { builtinProviders } from "@hookpipe/providers";
import { HookpipeClient } from "../client.js";
import { output, outputSuccess, outputError, isJsonMode } from "../output.js";
import { loadConfig } from "../config.js";

export const connectCommand = new Command("connect")
  .description("One-shot setup: create source + destination + subscription")
  .argument("<provider>", "Provider ID (stripe, github, slack, shopify, vercel, or generic)")
  .requiredOption("--secret <secret>", "Webhook signing secret from the provider")
  .requiredOption("--to <url>", "Destination URL (your API endpoint)")
  .option("--events <filter>", "Event type filter (default: *)", "*")
  .option("--name <name>", "Source name (default: provider ID)")
  .option("--retry <strategy>", "Retry strategy: exponential, linear, fixed", "exponential")
  .option("--max-retries <n>", "Maximum retry attempts", "10")
  .option("--json", "Output as JSON")
  .option("--dry-run", "Show what would be created without executing")
  .addHelpText("after", `
Examples:
  # Stripe → your API (payment events only)
  $ hookpipe connect stripe --secret whsec_xxx --to https://api.example.com/hooks --events "payment_intent.*"

  # GitHub → your API (all events)
  $ hookpipe connect github --secret ghsec_xxx --to https://api.example.com/hooks

  # Multiple environments
  $ hookpipe connect stripe --secret whsec_prod --to https://api.myapp.com/hooks --name stripe-prod
  $ hookpipe connect stripe --secret whsec_stg --to https://staging.myapp.com/hooks --name stripe-staging

  # Dry run (validate without creating)
  $ hookpipe connect stripe --secret whsec_xxx --to https://api.example.com/hooks --dry-run

  # Generic provider (no built-in knowledge)
  $ hookpipe connect my-service --secret my_secret --to https://api.example.com/hooks`)
  .action(async (providerArg: string, opts) => {
    const provider = builtinProviders[providerArg] ?? null;
    const sourceName = opts.name ?? providerArg;
    const events = opts.events.split(",").map((e: string) => e.trim());
    const config = loadConfig();

    // Build the plan
    const plan = {
      source: {
        name: sourceName,
        provider: provider ? providerArg : undefined,
        verification: {
          type: provider
            ? resolveVerificationType(provider)
            : "hmac-sha256",
          secret: opts.secret,
        },
      },
      destination: {
        name: slugify(opts.to),
        url: opts.to,
        retry_policy: {
          strategy: opts.retry,
          max_retries: parseInt(opts.maxRetries, 10),
        },
      },
      subscription: {
        event_types: events,
      },
    };

    if (opts.dryRun) {
      output({ dry_run: true, ...plan });
      return;
    }

    const client = new HookpipeClient();

    try {
      // 1. Create source
      const srcRes = await client.createSource(plan.source);
      const src = srcRes.data as { id: string; name: string };

      // 2. Create destination
      const dstRes = await client.createDestination(plan.destination);
      const dst = dstRes.data as { id: string; name: string; url: string };

      // 3. Create subscription
      const subRes = await client.createSubscription({
        source_id: src.id,
        destination_id: dst.id,
        event_types: events,
      });
      const sub = subRes.data as { id: string };

      // Build webhook URL
      const baseUrl = config.api_url.replace(/\/$/, "");
      const webhookUrl = `${baseUrl}/webhooks/${src.id}`;

      // Build next_steps with resolved {{webhook_url}} placeholder
      const nextSteps = provider?.nextSteps ?? null;
      const resolvedCli = nextSteps?.cli
        ? {
            ...nextSteps.cli,
            args: nextSteps.cli.args.map((a: string) => a.replace("{{webhook_url}}", webhookUrl)),
          }
        : null;

      if (isJsonMode()) {
        output({
          data: {
            source: { id: src.id, name: src.name, provider: providerArg },
            destination: { id: dst.id, name: dst.name, url: dst.url },
            subscription: { id: sub.id, event_types: events },
            webhook_url: webhookUrl,
          },
          next_steps: nextSteps
            ? {
                dashboard: nextSteps.dashboard ? { url: nextSteps.dashboard, path: nextSteps.instruction } : undefined,
                cli: resolvedCli,
                docs_url: nextSteps.docsUrl,
              }
            : null,
        });
      } else {
        outputSuccess(`Connected ${providerArg} → ${opts.to}`);
        console.log();
        console.log(`  Source:       ${src.id} (${src.name})`);
        console.log(`  Destination:  ${dst.id} (${dst.name})`);
        console.log(`  Events:       ${events.join(", ")}`);
        console.log();
        console.log(`  Webhook URL:`);
        console.log(`    ${webhookUrl}`);
        console.log();

        if (nextSteps) {
          console.log(`  Register this URL with ${provider?.name ?? providerArg}:`);

          // CLI first if available (user is already in terminal)
          if (resolvedCli) {
            console.log(`    CLI:       ${resolvedCli.binary} ${resolvedCli.args.join(" ")}`);
          }
          if (nextSteps.dashboard) {
            console.log(`    Dashboard: ${nextSteps.dashboard}`);
          }
          if (nextSteps.instruction) {
            console.log(`               ${nextSteps.instruction}`);
          }
          if (nextSteps.docsUrl) {
            console.log(`    Docs:      ${nextSteps.docsUrl}`);
          }
        } else {
          console.log(`  Next: configure your service to send webhooks to the URL above.`);
        }
      }
    } catch (err) {
      // Rollback is best-effort — log what was created
      outputError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

function resolveVerificationType(provider: { verification: { type?: string; algorithm?: string } }): string {
  const v = provider.verification;
  if ("type" in v && v.type && v.type !== "custom") return v.type === "stripe-signature" ? "stripe" : v.type === "slack-signature" ? "slack" : v.type;
  if ("algorithm" in v && v.algorithm) return v.algorithm;
  return "hmac-sha256";
}

function slugify(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/\./g, "-").slice(0, 50);
  } catch {
    return "destination";
  }
}
