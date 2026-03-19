import { defineProvider } from "../define";

export const shopify = defineProvider({
  id: "shopify",
  name: "Shopify",
  website: "https://shopify.com",
  dashboardUrl: "https://admin.shopify.com/settings/notifications",

  verification: {
    header: "x-shopify-hmac-sha256",
    algorithm: "hmac-sha256",
    encoding: "base64",
  },

  parseEventType: (_body, headers) => headers?.["x-shopify-topic"] ?? "unknown",
  parseEventId: (_body, headers) => headers?.["x-shopify-webhook-id"] ?? null,

  events: {
    "orders/create": { description: "New order placed", category: "orders" },
    "orders/updated": { description: "Order updated", category: "orders" },
    "orders/cancelled": { description: "Order cancelled", category: "orders" },
    "orders/fulfilled": { description: "Order fulfilled", category: "orders" },
    "orders/paid": { description: "Order paid", category: "orders" },
    "products/create": { description: "New product created", category: "products" },
    "products/update": { description: "Product updated", category: "products" },
    "products/delete": { description: "Product deleted", category: "products" },
    "customers/create": { description: "New customer created", category: "customers" },
    "customers/update": { description: "Customer updated", category: "customers" },
    "customers/delete": { description: "Customer deleted", category: "customers" },
    "carts/create": { description: "New cart created", category: "carts" },
    "carts/update": { description: "Cart updated", category: "carts" },
    "checkouts/create": { description: "Checkout created", category: "checkouts" },
    "checkouts/update": { description: "Checkout updated", category: "checkouts" },
    "refunds/create": { description: "Refund created", category: "orders" },
    "app/uninstalled": { description: "App uninstalled from store", category: "app" },
  },

  presets: {
    orders: ["orders/*"],
    products: ["products/*"],
    customers: ["customers/*"],
    all: ["*"],
  },

  nextSteps: {
    dashboard: "https://admin.shopify.com/store/{store}/settings/notifications",
    instruction: "Go to Shopify Admin → Settings → Notifications → Webhooks, create a webhook with the URL",
    docsUrl: "https://shopify.dev/docs/apps/build/webhooks",
    cli: {
      binary: "shopify",
      args: ["app", "webhooks", "trigger", "--topic", "orders/create", "--address", "{{webhook_url}}"],
      install: "npm i -g @shopify/cli",
    },
  },
});
