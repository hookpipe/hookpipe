/**
 * Generate GitHub webhook event catalog from @octokit/webhooks-types.
 *
 * Reads the EventPayloadMap interface to extract all event names,
 * then generates a complete event list with descriptions and categories.
 *
 * Usage: pnpm gen:github
 * Output: src/github/_generated-events.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- Find @octokit/webhooks-types ---

function findOctokitDts(): string {
  const candidates = [
    resolve(ROOT, "node_modules/@octokit/webhooks-types/schema.d.ts"),
    resolve(ROOT, "../../node_modules/@octokit/webhooks-types/schema.d.ts"),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }

  // pnpm structure
  const found = execSync(
    `find ${resolve(ROOT, "../../node_modules/.pnpm")} -path "*/@octokit/webhooks-types/schema.d.ts" 2>/dev/null | head -1`,
    { encoding: "utf-8" },
  ).trim();

  if (!found) {
    throw new Error(
      "Cannot find @octokit/webhooks-types. Run: pnpm add -D @octokit/webhooks-types",
    );
  }
  return found;
}

// --- Extract event names from EventPayloadMap ---

function extractEventNames(dtsContent: string): string[] {
  const match = dtsContent.match(
    /export\s+interface\s+EventPayloadMap\s*\{([\s\S]*?)\}/,
  );
  if (!match) {
    throw new Error("Cannot find EventPayloadMap in @octokit/webhooks-types");
  }

  const block = match[1];
  const events: string[] = [];
  const regex = /^\s+(\w+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(block)) !== null) {
    events.push(m[1]);
  }

  if (events.length < 20) {
    throw new Error(
      `Only found ${events.length} GitHub events — expected 50+. Schema format may have changed.`,
    );
  }

  return events.sort();
}

// --- Extract action subtypes for each event ---

function extractActions(dtsContent: string, eventName: string): string[] {
  // Look for union types like: type IssuesEvent = IssuesOpenedEvent | IssuesClosedEvent | ...
  const pascalName = eventName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

  const regex = new RegExp(
    `export\\s+type\\s+${pascalName}Event\\s*=\\s*([^;]+);`,
  );
  const match = dtsContent.match(regex);
  if (!match) return [];

  const unionStr = match[1];
  const actions: string[] = [];
  const actionRegex = new RegExp(`${pascalName}(\\w+)Event`, "g");
  let m: RegExpExecArray | null;
  while ((m = actionRegex.exec(unionStr)) !== null) {
    // Convert PascalCase to snake_case
    const action = m[1]
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
    actions.push(action);
  }
  return actions;
}

// --- Auto-generate descriptions and categories ---

const CATEGORY_MAP: Record<string, string> = {
  branch_protection_configuration: "security",
  branch_protection_rule: "security",
  check_run: "ci",
  check_suite: "ci",
  code_scanning_alert: "security",
  commit_comment: "code",
  create: "code",
  custom_property: "admin",
  custom_property_values: "admin",
  delete: "code",
  dependabot_alert: "security",
  deploy_key: "deployments",
  deployment: "deployments",
  deployment_protection_rule: "deployments",
  deployment_review: "deployments",
  deployment_status: "deployments",
  discussion: "community",
  discussion_comment: "community",
  fork: "social",
  github_app_authorization: "apps",
  gollum: "code",
  installation: "apps",
  installation_repositories: "apps",
  installation_target: "apps",
  issue_comment: "issues",
  issues: "issues",
  label: "admin",
  marketplace_purchase: "marketplace",
  member: "admin",
  membership: "admin",
  merge_group: "code",
  meta: "system",
  milestone: "issues",
  org_block: "admin",
  organization: "admin",
  package: "packages",
  page_build: "pages",
  ping: "system",
  project: "projects",
  project_card: "projects",
  project_column: "projects",
  projects_v2_item: "projects",
  public: "admin",
  pull_request: "code",
  pull_request_review: "code",
  pull_request_review_comment: "code",
  pull_request_review_thread: "code",
  push: "code",
  registry_package: "packages",
  release: "releases",
  repository: "admin",
  repository_dispatch: "automation",
  repository_import: "admin",
  repository_vulnerability_alert: "security",
  secret_scanning_alert: "security",
  secret_scanning_alert_location: "security",
  security_advisory: "security",
  sponsorship: "social",
  star: "social",
  status: "ci",
  team: "admin",
  team_add: "admin",
  watch: "social",
  workflow_dispatch: "ci",
  workflow_job: "ci",
  workflow_run: "ci",
};

function categorize(event: string): string {
  return CATEGORY_MAP[event] ?? "other";
}

function humanize(event: string): string {
  return event
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function humanizeAction(event: string, action: string): string {
  return `${humanize(event)} ${action.replace(/_/g, " ")}`;
}

// --- Generate output ---

function generate(): void {
  const dtsPath = findOctokitDts();
  const dtsContent = readFileSync(dtsPath, "utf-8");
  const events = extractEventNames(dtsContent);

  // Read package version
  let pkgVersion = "unknown";
  try {
    const pkgPath = dtsPath.replace(/\/schema\.d\.ts$/, "/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    pkgVersion = pkg.version;
  } catch {
    // ignore
  }

  // Build event entries: top-level events + action subtypes
  const entries: Array<{ key: string; description: string; category: string }> =
    [];

  for (const event of events) {
    entries.push({
      key: event,
      description: humanize(event),
      category: categorize(event),
    });

    // Extract action subtypes
    const actions = extractActions(dtsContent, event);
    for (const action of actions) {
      entries.push({
        key: `${event}.${action}`,
        description: humanizeAction(event, action),
        category: categorize(event),
      });
    }
  }

  const lines: string[] = [
    "// AUTO-GENERATED — do not edit manually.",
    `// Source: @octokit/webhooks-types@${pkgVersion} EventPayloadMap`,
    `// Generated: ${new Date().toISOString().split("T")[0]}`,
    "// Regenerate: pnpm gen:github",
    "",
    'import type { EventDefinition } from "../define";',
    "",
    "export const githubEventTypes = [",
    ...entries.map((e) => `  "${e.key}",`),
    "] as const;",
    "",
    "export type GitHubEventType = (typeof githubEventTypes)[number];",
    "",
    "/** Auto-generated base descriptions. Hand-curated entries in github/index.ts override these. */",
    "export const generatedGitHubEvents: Record<GitHubEventType, string | EventDefinition> = {",
    ...entries.map(
      (e) =>
        `  "${e.key}": { description: "${e.description}", category: "${e.category}" },`,
    ),
    "};",
    "",
  ];

  const outPath = resolve(ROOT, "src/github/_generated-events.ts");
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(
    `✓ Generated ${entries.length} GitHub events (${events.length} top-level + ${entries.length - events.length} action subtypes) → src/github/_generated-events.ts`,
  );
}

generate();
