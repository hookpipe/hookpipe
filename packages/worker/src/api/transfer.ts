import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/types";
import type { ExportData, ImportResult } from "@hookpipe/shared";
import { createDb } from "../db/queries";
import * as db from "../db/queries";
import { generateId } from "../lib/id";
import { parseBody, importDataSchema } from "../lib/validation";
import { validateDestinationUrl } from "../lib/url-validation";

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/v1/export
 * Export all configuration (sources, destinations, subscriptions).
 */
app.get("/export", async (c) => {
  const d = createDb(c.env.DB);

  const [sources, destinations, subscriptions] = await Promise.all([
    db.listSources(d),
    db.listDestinations(d),
    db.listSubscriptions(d),
  ]);

  const data: ExportData = {
    version: "1",
    exported_at: new Date().toISOString(),
    sources,
    destinations,
    subscriptions,
  };

  return c.json({ data });
});

/**
 * POST /api/v1/import
 * Import configuration. Skips resources that already exist (by name).
 */
app.post("/import", async (c) => {
  const body = await parseBody(c, z.object({ data: importDataSchema }));

  const d = createDb(c.env.DB);

  const result: ImportResult = {
    sources: { created: 0, skipped: 0 },
    destinations: { created: 0, skipped: 0 },
    subscriptions: { created: 0, skipped: 0 },
  };

  // Map old IDs to new IDs for subscription re-linking
  const sourceIdMap = new Map<string, string>();
  const destIdMap = new Map<string, string>();

  // Import sources
  const existingSources = await db.listSources(d);
  const existingSourceNames = new Set(existingSources.map((s) => s.name));

  for (const src of body.data.sources ?? []) {
    if (existingSourceNames.has(src.name)) {
      // Map old ID to existing ID
      const existing = existingSources.find((s) => s.name === src.name)!;
      sourceIdMap.set(src.id, existing.id);
      result.sources.skipped++;
      continue;
    }

    const newId = generateId("src");
    sourceIdMap.set(src.id, newId);
    await db.createSource(d, {
      id: newId,
      name: src.name,
      provider: src.provider ?? null,
      verification_type: src.verification_type,
      verification_secret: src.verification_secret,
    });
    result.sources.created++;
  }

  // Import destinations
  const existingDests = await db.listDestinations(d);
  const existingDestNames = new Set(existingDests.map((d) => d.name));

  for (const dst of body.data.destinations ?? []) {
    if (existingDestNames.has(dst.name)) {
      const existing = existingDests.find((d) => d.name === dst.name)!;
      destIdMap.set(dst.id, existing.id);
      result.destinations.skipped++;
      continue;
    }

    // SSRF protection: validate destination URL before import
    const urlError = validateDestinationUrl(dst.url);
    if (urlError) {
      result.destinations.skipped++;
      continue;
    }

    const newId = generateId("dst");
    destIdMap.set(dst.id, newId);
    await db.createDestination(d, {
      id: newId,
      name: dst.name,
      url: dst.url,
      timeout_ms: dst.timeout_ms,
      retry_strategy: dst.retry_strategy,
      max_retries: dst.max_retries,
      retry_interval_ms: dst.retry_interval_ms,
      retry_max_interval_ms: dst.retry_max_interval_ms,
      retry_on_status: dst.retry_on_status,
    });
    result.destinations.created++;
  }

  // Import subscriptions (re-link to new IDs)
  for (const sub of body.data.subscriptions ?? []) {
    const newSourceId = sourceIdMap.get(sub.source_id);
    const newDestId = destIdMap.get(sub.destination_id);

    if (!newSourceId || !newDestId) {
      result.subscriptions.skipped++;
      continue;
    }

    // Check if subscription already exists
    const existingSubs = await db.getSubscriptionsBySource(d, newSourceId);
    const alreadyExists = existingSubs.some(
      (s) => s.destination_id === newDestId,
    );

    if (alreadyExists) {
      result.subscriptions.skipped++;
      continue;
    }

    await db.createSubscription(d, {
      id: generateId("sub"),
      source_id: newSourceId,
      destination_id: newDestId,
      event_types: sub.event_types,
    });
    result.subscriptions.created++;
  }

  return c.json({ data: result });
});

export { app as transferApi };
