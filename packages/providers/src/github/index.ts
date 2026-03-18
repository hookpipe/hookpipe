import { z } from "zod";
import { defineProvider } from "../define";

const ghRepo = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
}).passthrough();

const ghUser = z.object({
  login: z.string(),
  id: z.number(),
}).passthrough();

export const github = defineProvider({
  id: "github",
  name: "GitHub",
  website: "https://github.com",
  dashboardUrl: "https://github.com/settings/hooks",

  verification: {
    header: "x-hub-signature-256",
    algorithm: "hmac-sha256",
  },

  parseEventType: (_body, headers) => headers?.["x-github-event"] ?? "unknown",
  parseEventId: (_body, headers) => headers?.["x-github-delivery"] ?? null,

  events: {
    push: {
      description: "Push to a repository",
      category: "code",
      schema: z.object({
        ref: z.string(),
        before: z.string(),
        after: z.string(),
        commits: z.array(z.object({
          id: z.string(),
          message: z.string(),
          author: z.object({ name: z.string(), email: z.string() }).passthrough(),
        }).passthrough()),
        pusher: z.object({ name: z.string(), email: z.string() }).passthrough(),
        repository: ghRepo,
        sender: ghUser,
      }).passthrough(),
    },
    pull_request: {
      description: "Pull request opened, closed, merged, etc.",
      category: "code",
      schema: z.object({
        action: z.string(),
        number: z.number(),
        pull_request: z.object({
          id: z.number(),
          number: z.number(),
          title: z.string(),
          state: z.string(),
          user: ghUser,
          merged: z.boolean().nullable(),
          draft: z.boolean(),
        }).passthrough(),
        repository: ghRepo,
        sender: ghUser,
      }).passthrough(),
    },
    "pull_request.opened": { description: "Pull request opened", category: "code" },
    "pull_request.closed": { description: "Pull request closed", category: "code" },
    "pull_request.merged": { description: "Pull request merged", category: "code" },
    issues: { description: "Issue opened, closed, etc.", category: "issues" },
    "issues.opened": { description: "Issue opened", category: "issues" },
    "issues.closed": { description: "Issue closed", category: "issues" },
    issue_comment: { description: "Comment on an issue or PR", category: "issues" },
    release: { description: "Release published, created, etc.", category: "releases" },
    "release.published": { description: "Release published", category: "releases" },
    workflow_run: { description: "GitHub Actions workflow run", category: "ci" },
    "workflow_run.completed": { description: "Actions workflow completed", category: "ci" },
    star: { description: "Repository starred/unstarred", category: "social" },
    fork: { description: "Repository forked", category: "social" },
    create: { description: "Branch or tag created", category: "code" },
    delete: { description: "Branch or tag deleted", category: "code" },
    ping: { description: "Webhook ping (sent when webhook is created)", category: "system" },
  },

  presets: {
    code: ["push", "pull_request", "create", "delete"],
    ci: ["workflow_run.*"],
    issues: ["issues.*", "issue_comment"],
    releases: ["release.*"],
    all: ["*"],
  },

  nextSteps: {
    dashboard: "https://github.com/{owner}/{repo}/settings/hooks",
    instruction: "Go to your repo Settings → Webhooks → Add webhook, paste the webhook URL",
    docsUrl: "https://docs.github.com/en/webhooks",
    cli: {
      binary: "gh",
      args: ["api", "repos/{owner}/{repo}/hooks", "-f", "url={{webhook_url}}", "-f", "content_type=json"],
      install: "brew install gh",
    },
  },
});
