import { loadConfig } from "./config.js";

export interface ApiResponse<T = unknown> {
  data?: T;
  message?: string;
  error?: { message: string; code: string };
}

export class HookpipeClient {
  private baseUrl: string;
  private token?: string;

  constructor(opts?: { apiUrl?: string; token?: string }) {
    const config = loadConfig();
    this.baseUrl = (opts?.apiUrl ?? config.api_url).replace(/\/$/, "");
    this.token = opts?.token ?? config.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as ApiResponse<T>;

    if (!res.ok) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return json;
  }

  // Sources
  listSources() {
    return this.request("GET", "/api/v1/sources");
  }

  getSource(id: string) {
    return this.request("GET", `/api/v1/sources/${id}`);
  }

  createSource(body: { name: string; provider?: string; verification?: { type: string; secret: string } }) {
    return this.request("POST", "/api/v1/sources", body);
  }

  updateSource(id: string, body: Record<string, unknown>) {
    return this.request("PUT", `/api/v1/sources/${id}`, body);
  }

  deleteSource(id: string) {
    return this.request("DELETE", `/api/v1/sources/${id}`);
  }

  // Destinations
  listDestinations() {
    return this.request("GET", "/api/v1/destinations");
  }

  getDestination(id: string) {
    return this.request("GET", `/api/v1/destinations/${id}`);
  }

  createDestination(body: {
    name: string;
    url: string;
    retry_policy?: Record<string, number>;
  }) {
    return this.request("POST", "/api/v1/destinations", body);
  }

  updateDestination(id: string, body: Record<string, unknown>) {
    return this.request("PUT", `/api/v1/destinations/${id}`, body);
  }

  deleteDestination(id: string) {
    return this.request("DELETE", `/api/v1/destinations/${id}`);
  }

  // Subscriptions
  listSubscriptions() {
    return this.request("GET", "/api/v1/subscriptions");
  }

  createSubscription(body: {
    source_id: string;
    destination_id: string;
    event_types?: string[];
  }) {
    return this.request("POST", "/api/v1/subscriptions", body);
  }

  deleteSubscription(id: string) {
    return this.request("DELETE", `/api/v1/subscriptions/${id}`);
  }

  // Events
  listEvents(opts?: { source_id?: string; after?: string; limit?: number; include_payload?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.source_id) params.set("source_id", opts.source_id);
    if (opts?.after) params.set("after", opts.after);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.include_payload) params.set("include_payload", "true");
    const qs = params.toString();
    return this.request("GET", `/api/v1/events${qs ? `?${qs}` : ""}`);
  }

  listDeliveries(opts?: { after?: string; destination_id?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    if (opts?.destination_id) params.set("destination_id", opts.destination_id);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request("GET", `/api/v1/events/deliveries${qs ? `?${qs}` : ""}`);
  }

  getEvent(id: string) {
    return this.request("GET", `/api/v1/events/${id}`);
  }

  getEventDeliveries(eventId: string) {
    return this.request("GET", `/api/v1/events/${eventId}/deliveries`);
  }

  replayEvent(id: string) {
    return this.request("POST", `/api/v1/events/${id}/replay`);
  }

  // Transfer (export/import)
  exportConfig() {
    return this.request("GET", "/api/v1/export");
  }

  importConfig(data: unknown) {
    return this.request("POST", "/api/v1/import", { data });
  }

  // Health
  health() {
    return this.request("GET", "/health");
  }
}
