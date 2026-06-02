import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));

import {
  buildShopifyIdVariants,
  getComplianceWebhookSummary,
  isComplianceTopic,
  normalizeComplianceTopic,
  redactCustomerData,
  redactShopData,
} from "../../app/lib/shopify-compliance-webhooks.server";

describe("Shopify compliance webhook helpers", () => {
  it("normalizes Shopify SDK topic names and detects mandatory compliance topics", () => {
    expect(normalizeComplianceTopic("CUSTOMERS_DATA_REQUEST")).toBe("customers/data_request");
    expect(normalizeComplianceTopic("customers/redact")).toBe("customers/redact");
    expect(isComplianceTopic("CUSTOMERS_DATA_REQUEST")).toBe(true);
    expect(isComplianceTopic("CUSTOMERS_REDACT")).toBe(true);
    expect(isComplianceTopic("SHOP_REDACT")).toBe(true);
    expect(isComplianceTopic("APP_UNINSTALLED")).toBe(false);
  });

  it("builds raw and gid Shopify ID variants for order redaction", () => {
    expect(buildShopifyIdVariants([123, "gid://shopify/Order/456"], "Order")).toEqual([
      "123",
      "gid://shopify/Order/123",
      "gid://shopify/Order/456",
    ]);
  });

  it("summarizes compliance payloads without customer email or phone", () => {
    const summary = getComplianceWebhookSummary({
      topic: "CUSTOMERS_DATA_REQUEST",
      shop: "demo.myshopify.com",
      payload: {
        customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
        orders_requested: [299938, 280263],
        data_request: { id: 9999 },
      },
    });

    expect(summary).toEqual({
      topic: "customers/data_request",
      shop: "demo.myshopify.com",
      ordersRequestedCount: 2,
      ordersToRedactCount: 0,
      dataRequestId: "9999",
    });
    expect(JSON.stringify(summary)).not.toContain("john@example.com");
    expect(JSON.stringify(summary)).not.toContain("555-625-1199");
    expect(JSON.stringify(summary)).not.toContain("191167");
  });

  it("redacts stored timeline order references for customer redaction requests", async () => {
    const calls = [];
    const prisma = {
      productTimelineEvent: {
        updateMany: async (args) => {
          calls.push(args);
          return { count: 2 };
        },
      },
    };

    const result = await redactCustomerData({
      prisma,
      shop: "demo.myshopify.com",
      payload: { orders_to_redact: [299938] },
    });

    expect(result).toEqual({ productTimelineEventsUpdated: 2 });
    expect(calls[0]).toEqual({
      where: {
        shop: "demo.myshopify.com",
        orderId: { in: ["299938", "gid://shopify/Order/299938"] },
      },
      data: { orderId: null },
    });
  });

  it("deletes app-owned shop data on shop redaction requests", async () => {
    const calls = [];
    const tx = new Proxy(
      {},
      {
        get(_target, modelName) {
          if (modelName === "then") return undefined;
          return {
            deleteMany: async (args) => {
              calls.push({ modelName, args });
              return { count: 1 };
            },
          };
        },
      },
    );
    const prisma = {
      $transaction: async (callback) => callback(tx),
    };

    const result = await redactShopData({ prisma, shop: "demo.myshopify.com" });

    expect(result.length).toBeGreaterThan(20);
    expect(calls).toContainEqual({
      modelName: "session",
      args: { where: { shop: "demo.myshopify.com" } },
    });
    expect(calls).toContainEqual({
      modelName: "productRetentionRun",
      args: { where: { shopId: "demo.myshopify.com" } },
    });
  });
});
