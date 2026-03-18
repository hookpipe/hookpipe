import { z } from "zod";
import { defineProvider } from "../define";

const stripeEvent = z.object({
  id: z.string(),
  object: z.literal("event"),
  api_version: z.string().nullable(),
  created: z.number(),
});

export const stripe = defineProvider({
  id: "stripe",
  name: "Stripe",
  website: "https://stripe.com",
  dashboardUrl: "https://dashboard.stripe.com/webhooks",

  verification: {
    type: "stripe-signature",
    header: "stripe-signature",
  },

  parseEventType: (body) => (body as Record<string, unknown>).type as string,
  parseEventId: (body) => (body as Record<string, unknown>).id as string,

  events: {
    "payment_intent.created": { description: "Payment intent created", category: "payments" },
    "payment_intent.succeeded": {
      description: "Payment completed successfully",
      category: "payments",
      schema: stripeEvent.extend({
        type: z.literal("payment_intent.succeeded"),
        data: z.object({
          object: z.object({
            id: z.string(),
            amount: z.number(),
            currency: z.string(),
            status: z.literal("succeeded"),
          }).passthrough(),
        }),
      }).passthrough(),
    },
    "payment_intent.payment_failed": { description: "Payment attempt failed", category: "payments" },
    "payment_intent.canceled": { description: "Payment intent canceled", category: "payments" },
    "charge.succeeded": { description: "Charge succeeded", category: "payments" },
    "charge.failed": { description: "Charge failed", category: "payments" },
    "charge.refunded": { description: "Charge refunded", category: "payments" },
    "charge.dispute.created": { description: "Dispute opened", category: "disputes" },
    "charge.dispute.closed": { description: "Dispute resolved", category: "disputes" },
    "customer.created": { description: "New customer created", category: "customers" },
    "customer.updated": { description: "Customer details updated", category: "customers" },
    "customer.deleted": { description: "Customer deleted", category: "customers" },
    "customer.subscription.created": {
      description: "New subscription started",
      category: "billing",
      schema: stripeEvent.extend({
        type: z.literal("customer.subscription.created"),
        data: z.object({
          object: z.object({
            id: z.string(),
            customer: z.string(),
            status: z.string(),
            current_period_start: z.number(),
            current_period_end: z.number(),
          }).passthrough(),
        }),
      }).passthrough(),
    },
    "customer.subscription.updated": { description: "Subscription updated", category: "billing" },
    "customer.subscription.deleted": { description: "Subscription cancelled", category: "billing" },
    "customer.subscription.trial_will_end": { description: "Trial ending in 3 days", category: "billing" },
    "invoice.created": { description: "Invoice created", category: "billing" },
    "invoice.paid": { description: "Invoice paid", category: "billing" },
    "invoice.payment_failed": { description: "Invoice payment failed", category: "billing" },
    "invoice.finalized": { description: "Invoice finalized", category: "billing" },
    "checkout.session.completed": {
      description: "Checkout session completed",
      category: "checkout",
      schema: stripeEvent.extend({
        type: z.literal("checkout.session.completed"),
        data: z.object({
          object: z.object({
            id: z.string(),
            payment_status: z.string(),
            status: z.literal("complete"),
            amount_total: z.number().nullable(),
            currency: z.string().nullable(),
          }).passthrough(),
        }),
      }).passthrough(),
    },
    "checkout.session.expired": { description: "Checkout session expired", category: "checkout" },
  },

  presets: {
    payments: ["payment_intent.*", "charge.*"],
    billing: ["customer.subscription.*", "invoice.*"],
    checkout: ["checkout.session.*"],
    customers: ["customer.*"],
    all: ["*"],
  },

  nextSteps: {
    dashboard: "https://dashboard.stripe.com/webhooks",
    instruction: "Add the webhook URL as an endpoint in Stripe Dashboard → Developers → Webhooks",
    docsUrl: "https://docs.stripe.com/webhooks",
    cli: {
      binary: "stripe",
      args: ["webhook_endpoints", "create", "--url", "{{webhook_url}}"],
      install: "brew install stripe/stripe-cli/stripe",
    },
  },
});
