import { Command } from "commander";
import { builtinProviders, type Provider, type EventDefinition } from "@hookpipe/providers";
import { output, outputTable, isJsonMode } from "../output.js";

export const providersCommand = new Command("providers")
  .description("Browse built-in webhook provider catalog");

providersCommand
  .command("list")
  .alias("ls")
  .description("List available providers")
  .action(() => {
    const providers = Object.values(builtinProviders);

    if (isJsonMode()) {
      output(providers.map((p) => ({
        id: p.id,
        name: p.name,
        website: p.website,
        events: Object.keys(p.events).length,
        presets: p.presets ? Object.keys(p.presets) : [],
      })));
      return;
    }

    outputTable(
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        events: Object.keys(p.events).length,
        verification: formatVerification(p),
      })),
    );
  });

providersCommand
  .command("describe")
  .description("Show provider details, events, and presets")
  .argument("<name>", "Provider ID (stripe, github, slack, shopify, vercel)")
  .action((name: string) => {
    const provider = builtinProviders[name];
    if (!provider) {
      const available = Object.keys(builtinProviders).join(", ");
      throw new Error(`Unknown provider: ${name}. Available: ${available}`);
    }

    if (isJsonMode()) {
      output({
        id: provider.id,
        name: provider.name,
        website: provider.website,
        dashboardUrl: provider.dashboardUrl,
        verification: provider.verification,
        events: provider.events,
        presets: provider.presets,
        setup: provider.nextSteps ? {
          dashboard: provider.nextSteps.dashboard,
          instruction: provider.nextSteps.instruction,
          docs_url: provider.nextSteps.docsUrl,
          cli: provider.nextSteps.cli,
        } : null,
        hasChallenge: !!provider.challenge,
      });
      return;
    }

    // Human-friendly output
    console.log(`${provider.name} (${provider.id})`);
    if (provider.website) console.log(`  ${provider.website}`);
    console.log();

    console.log("Verification:");
    console.log(`  ${formatVerification(provider)}`);
    console.log();

    console.log("Events:");
    const events = provider.events;
    const categories = new Map<string, string[]>();
    for (const [type, def] of Object.entries(events)) {
      const cat = typeof def === "string" ? "general" : (def as EventDefinition).category ?? "general";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(type);
    }
    for (const [cat, types] of categories) {
      console.log(`  [${cat}]`);
      for (const t of types) {
        const desc = typeof events[t] === "string" ? events[t] : (events[t] as EventDefinition).description;
        console.log(`    ${t} — ${desc}`);
      }
    }
    console.log();

    if (provider.presets) {
      console.log("Presets:");
      for (const [name, patterns] of Object.entries(provider.presets)) {
        console.log(`  ${name}: ${patterns.join(", ")}`);
      }
      console.log();
    }

    if (provider.nextSteps) {
      console.log("Setup:");
      if (provider.nextSteps.cli) {
        console.log(`  CLI:       ${provider.nextSteps.cli.binary} ${provider.nextSteps.cli.args.join(" ")}`);
      }
      if (provider.nextSteps.instruction) console.log(`  ${provider.nextSteps.instruction}`);
      if (provider.nextSteps.dashboard) console.log(`  Dashboard: ${provider.nextSteps.dashboard}`);
      if (provider.nextSteps.docsUrl) console.log(`  Docs:      ${provider.nextSteps.docsUrl}`);
    }
  });

function formatVerification(p: Provider): string {
  const v = p.verification;
  if ("type" in v && v.type !== "custom") return `${v.type} (${v.header})`;
  if ("algorithm" in v) {
    const enc = v.encoding ? `, ${v.encoding}` : "";
    return `${v.algorithm}${enc} (${v.header})`;
  }
  return "custom";
}
