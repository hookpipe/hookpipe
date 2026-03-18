/**
 * DLQ notification — alerts when deliveries permanently fail.
 *
 * When an event exhausts all retries and enters the DLQ, hookpipe can send
 * a notification webhook to a configured URL. This is a "meta-webhook" —
 * a webhook about your webhooks.
 *
 * Configuration via environment variable:
 *   DLQ_NOTIFICATION_URL = "https://your-team.slack.com/webhook/xxx"
 *
 * The notification payload:
 * {
 *   "type": "delivery.dlq",
 *   "delivery_id": "dlv_xxx",
 *   "event_id": "evt_xxx",
 *   "destination_id": "dst_xxx",
 *   "destination_url": "https://...",
 *   "attempt": 10,
 *   "last_status_code": 500,
 *   "last_response": "Internal Server Error",
 *   "timestamp": "2026-03-16T..."
 * }
 */

export interface DlqNotificationPayload {
  type: "delivery.dlq";
  delivery_id: string;
  event_id: string;
  destination_id: string;
  destination_url: string;
  attempt: number;
  last_status_code: number | null;
  last_response: string;
  timestamp: string;
}

/**
 * Send a DLQ notification if DLQ_NOTIFICATION_URL is configured.
 * Fire-and-forget — notification failure does not affect delivery logic.
 */
export async function sendDlqNotification(
  notificationUrl: string | undefined,
  payload: DlqNotificationPayload,
): Promise<void> {
  if (!notificationUrl) return;

  try {
    await fetch(notificationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "hookpipe/dlq-notification",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Notification failure is non-fatal — log and continue
    console.error(`DLQ notification failed for delivery ${payload.delivery_id}`);
  }
}
