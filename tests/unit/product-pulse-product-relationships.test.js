import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it, vi } from "vitest";
import { buildQuickScanCandidates } from "../../app/lib/product-pulse-quick-scan.server";
import {
  buildProductRelationshipSummary,
  getProductRelationshipSummaryForShop,
} from "../../app/lib/product-pulse-product-relationships.server";

const SHOP = "shop-a.myshopify.com";
const PRODUCT_A = "gid://shopify/Product/a";
const PRODUCT_B = "gid://shopify/Product/b";
const PRODUCT_C = "gid://shopify/Product/c";
const PRODUCT_POPULAR = "gid://shopify/Product/popular";
const VARIANT_A = "gid://shopify/ProductVariant/a";
const VARIANT_B = "gid://shopify/ProductVariant/b";
const VARIANT_C = "gid://shopify/ProductVariant/c";
const VARIANT_POPULAR = "gid://shopify/ProductVariant/popular";

function products() {
  return [
    { id: PRODUCT_A, title: "Product A", handle: "product-a", variants: [{ id: VARIANT_A }] },
    { id: PRODUCT_B, title: "Product B", handle: "product-b", imageUrl: "https://cdn.example/product-b.jpg", variants: [{ id: VARIANT_B }] },
    { id: PRODUCT_C, title: "Product C", handle: "product-c", variants: [{ id: VARIANT_C }] },
    { id: PRODUCT_POPULAR, title: "Popular Product", handle: "popular-product", variants: [{ id: VARIANT_POPULAR }] },
  ];
}

function sale(overrides = {}) {
  return {
    type: "sale",
    shop: SHOP,
    productId: PRODUCT_A,
    variantId: VARIANT_A,
    orderId: "order-1",
    lineItemId: "line-a-1",
    quantity: 1,
    amount: 100,
    orderDate: "2026-05-01T12:00:00.000Z",
    ...overrides,
  };
}

function itemReturn(overrides = {}) {
  return {
    type: "return",
    shop: SHOP,
    productId: PRODUCT_A,
    variantId: VARIANT_A,
    orderId: "order-1",
    lineItemId: "line-a-1",
    quantity: 1,
    occurredAt: "2026-05-03T12:00:00.000Z",
    ...overrides,
  };
}

function refund(overrides = {}) {
  return {
    type: "refund",
    shop: SHOP,
    productId: PRODUCT_A,
    variantId: VARIANT_A,
    orderId: "order-1",
    lineItemId: "line-a-1",
    quantity: 1,
    amount: 100,
    occurredAt: "2026-05-04T12:00:00.000Z",
    ...overrides,
  };
}

function summaryFor(events, productId = PRODUCT_A, options = {}) {
  return buildProductRelationshipSummary({
    shop: SHOP,
    productId,
    products: products(),
    events,
    windowDays: 90,
    assumeCompleteOrderEvents: true,
    ...options,
  });
}

describe("product relationship intelligence metrics", () => {
  it("calculates same-order attach rate, lift, strength, and confidence", () => {
    const summary = summaryFor([
      sale({ orderId: "order-1", lineItemId: "line-a-1" }),
      sale({ orderId: "order-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B, quantity: 2, amount: 80 }),
      sale({ orderId: "order-2", lineItemId: "line-a-2" }),
      sale({ orderId: "order-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B, amount: 40 }),
      sale({ orderId: "order-3", lineItemId: "line-a-3" }),
      sale({ orderId: "order-4", lineItemId: "line-b-4", productId: PRODUCT_B, variantId: VARIANT_B }),
    ]);

    expect(summary.same_order_relationships[0]).toMatchObject({
      related_product_id: PRODUCT_B,
      related_product_image_url: "https://cdn.example/product-b.jpg",
      relationship_direction: "together",
      time_window: "same_order",
      co_order_count: 2,
      co_unit_count: 3,
      co_revenue: 120,
      attach_rate: 0.6667,
      related_product_base_rate: 0.75,
      lift: 0.8889,
    });
    expect(summary.same_order_relationships[0].relationship_strength).not.toBe("insufficient_data");
    expect(summary.confidence.score).toBeGreaterThan(40);
  });

  it("uses Shopify order line item identity for related products missing from the local catalog", () => {
    const summary = buildProductRelationshipSummary({
      shop: SHOP,
      productId: PRODUCT_A,
      products: [{ id: PRODUCT_A, title: "Product A", handle: "product-a", variants: [{ id: VARIANT_A }] }],
      events: [
        sale({
          orderId: "basket-1",
          lineItemId: "line-a-basket",
          basketLineItems: [
            { lineItemId: "line-a-basket", productId: PRODUCT_A, variantId: VARIANT_A, title: "Product A", handle: "product-a", quantity: 1, amount: 100 },
            { lineItemId: "line-b-basket", productId: PRODUCT_B, variantId: VARIANT_B, title: "Shopify Related Product", handle: "shopify-related-product", imageUrl: "https://cdn.example/shopify-related.jpg", quantity: 1, amount: 40 },
          ],
        }),
      ],
      windowDays: 90,
      assumeCompleteOrderEvents: false,
    });

    expect(summary.top_bought_together[0]).toMatchObject({
      related_product_id: PRODUCT_B,
      related_product_title: "Shopify Related Product",
      related_product_handle: "shopify-related-product",
      related_product_image_url: "https://cdn.example/shopify-related.jpg",
    });
  });

  it("uses lift so a popular product does not dominate only by raw co-order count", () => {
    const events = [
      sale({ orderId: "a-1", lineItemId: "line-a-1" }),
      sale({ orderId: "a-1", lineItemId: "line-pop-a-1", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "a-2", lineItemId: "line-a-2" }),
      sale({ orderId: "a-2", lineItemId: "line-pop-a-2", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "a-3", lineItemId: "line-a-3" }),
      sale({ orderId: "a-3", lineItemId: "line-c-a-3", productId: PRODUCT_C, variantId: VARIANT_C }),
      sale({ orderId: "a-4", lineItemId: "line-a-4" }),
      sale({ orderId: "a-4", lineItemId: "line-pop-a-4", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "a-4", lineItemId: "line-c-a-4", productId: PRODUCT_C, variantId: VARIANT_C }),
      sale({ orderId: "pop-1", lineItemId: "line-pop-1", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "pop-2", lineItemId: "line-pop-2", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "pop-3", lineItemId: "line-pop-3", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
      sale({ orderId: "pop-4", lineItemId: "line-pop-4", productId: PRODUCT_POPULAR, variantId: VARIANT_POPULAR }),
    ];

    const summary = summaryFor(events);

    expect(summary.top_bought_together[0].related_product_id).toBe(PRODUCT_C);
    expect(summary.top_bought_together.find((item) => item.related_product_id === PRODUCT_POPULAR).co_order_count).toBe(3);
  });

  it("calculates previous-purchase and next-purchase directional relationships by customer window", () => {
    const summary = summaryFor([
      sale({ orderId: "c1-before", lineItemId: "line-c1-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "c1-source", lineItemId: "line-c1-a", customerKey: "customer-1", orderDate: "2026-05-10T12:00:00.000Z" }),
      sale({ orderId: "c1-after", lineItemId: "line-c1-c", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-1", amount: 70, orderDate: "2026-05-20T12:00:00.000Z" }),
      sale({ orderId: "c2-before", lineItemId: "line-c2-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "c2-source", lineItemId: "line-c2-a", customerKey: "customer-2", orderDate: "2026-05-18T12:00:00.000Z" }),
      sale({ orderId: "c3-source", lineItemId: "line-c3-a", customerKey: "customer-3", orderDate: "2026-05-18T12:00:00.000Z" }),
    ]);

    const previous30 = summary.previous_purchase_relationships.find((item) => item.related_product_id === PRODUCT_B && item.time_window === "30d_before");
    const next14 = summary.next_purchase_relationships.find((item) => item.related_product_id === PRODUCT_C && item.time_window === "14d_after");

    expect(previous30).toMatchObject({
      relationship_direction: "before",
      customer_count: 2,
      relationship_rate: 0.6667,
      median_days_before: 12,
    });
    expect(next14).toMatchObject({
      relationship_direction: "after",
      customer_count: 1,
      relationship_rate: 0.3333,
      avg_days_after: 10,
      follow_on_revenue: 70,
    });
  });

  it("keeps directionality distinct for A to B after versus B to A after", () => {
    const events = [
      sale({ orderId: "first", lineItemId: "line-a-first", customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "second", lineItemId: "line-b-second", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-05T12:00:00.000Z" }),
    ];

    const summaryA = summaryFor(events, PRODUCT_A);
    const summaryB = summaryFor(events, PRODUCT_B);

    expect(summaryA.next_purchase_relationships.some((item) => item.related_product_id === PRODUCT_B)).toBe(true);
    expect(summaryB.next_purchase_relationships.some((item) => item.related_product_id === PRODUCT_A)).toBe(false);
    expect(summaryB.previous_purchase_relationships.some((item) => item.related_product_id === PRODUCT_A)).toBe(true);
  });

  it("groups relationship trends by source product cohort month and classifies emerging trends", () => {
    const summary = summaryFor([
      sale({ orderId: "may-a", lineItemId: "line-may-a", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "jun-a", lineItemId: "line-jun-a", orderDate: "2026-06-03T12:00:00.000Z" }),
      sale({ orderId: "jun-a", lineItemId: "line-jun-b", productId: PRODUCT_B, variantId: VARIANT_B, orderDate: "2026-06-03T12:00:00.000Z" }),
    ]);

    const relationship = summary.same_order_relationships.find((item) => item.related_product_id === PRODUCT_B);

    expect(relationship.monthly).toEqual([
      expect.objectContaining({ month: "2026-05", source_product_orders: 1, related_order_count: 0 }),
      expect.objectContaining({ month: "2026-06", source_product_orders: 1, related_order_count: 1, relationship_rate: 1 }),
    ]);
    expect(relationship.trend).toBe("emerging");
  });

  it("lowers confidence when one customer dominates the signal", () => {
    const summary = summaryFor([
      sale({ orderId: "dom-1", lineItemId: "line-a-1", customerKey: "customer-1" }),
      sale({ orderId: "dom-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1" }),
      sale({ orderId: "dom-2", lineItemId: "line-a-2", customerKey: "customer-1", orderDate: "2026-05-02T12:00:00.000Z" }),
      sale({ orderId: "dom-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-02T12:00:00.000Z" }),
      sale({ orderId: "dom-3", lineItemId: "line-a-3", customerKey: "customer-1", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "dom-3", lineItemId: "line-b-3", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-03T12:00:00.000Z" }),
    ]);

    const relationship = summary.same_order_relationships[0];

    expect(relationship.warnings).toContain("single_customer_dominates");
    expect(relationship.confidence).toBeLessThan(80);
  });

  it("marks previous and next relationships unavailable when customer identity is missing", () => {
    const summary = summaryFor([
      sale({ orderId: "order-1", lineItemId: "line-a" }),
      sale({ orderId: "order-2", lineItemId: "line-b", productId: PRODUCT_B, variantId: VARIANT_B, orderDate: "2026-05-10T12:00:00.000Z" }),
    ]);

    expect(summary.previous_purchase_relationships).toEqual([]);
    expect(summary.next_purchase_relationships).toEqual([]);
    expect(summary.data_basis.customer_sequence_available).toBe(false);
    expect(summary.warnings).toContain("customer_identity_unavailable");
  });

  it("calculates return/refund impact for same-order relationships without overclaiming sequence causality", () => {
    const summary = summaryFor([
      sale({ orderId: "together", lineItemId: "line-a-together", quantity: 2, amount: 200 }),
      sale({ orderId: "together", lineItemId: "line-b-together", productId: PRODUCT_B, variantId: VARIANT_B, amount: 40 }),
      itemReturn({ orderId: "together", lineItemId: "line-a-together", quantity: 1 }),
      refund({ orderId: "together", lineItemId: "line-a-together", quantity: 1, amount: 100 }),
      sale({ orderId: "solo", lineItemId: "line-a-solo", quantity: 2, amount: 200 }),
    ]);

    const relationship = summary.same_order_relationships.find((item) => item.related_product_id === PRODUCT_B);

    expect(relationship).toMatchObject({
      return_rate_when_bought_together: 0.5,
      refund_rate_when_bought_together: 0.5,
      refund_amount_when_bought_together: 100,
      return_rate_when_not_bought_together: 0,
      refund_rate_when_not_bought_together: 0,
      delta_return_rate: 0.5,
      delta_refund_rate: 0.5,
    });
    expect(summary.relationships_with_return_risk_impact[0].related_product_id).toBe(PRODUCT_B);
  });

  it("preserves tenant isolation", () => {
    const summary = summaryFor([
      sale({ shop: "other-shop.myshopify.com", orderId: "foreign-a", lineItemId: "foreign-a" }),
      sale({ shop: "other-shop.myshopify.com", orderId: "foreign-a", lineItemId: "foreign-b", productId: PRODUCT_B, variantId: VARIANT_B }),
      sale({ shop: SHOP, orderId: "local-a", lineItemId: "local-a" }),
    ]);

    expect(summary.same_order_relationships).toEqual([]);
    expect(summary.data_basis.order_count).toBe(1);
  });

  it("stores product relationship intelligence on QuickScan candidate metrics", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 90,
      settings: { risk: { minimumScore: 0 }, momentum: { minimumScore: 101 } },
      products: products(),
      events: [
        sale({ shop: null, orderId: "order-1", lineItemId: "line-a-1" }),
        sale({ shop: null, orderId: "order-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B }),
      ],
    });
    const productCandidate = candidates.find((candidate) => candidate.productGid === PRODUCT_A);

    expect(productCandidate?.metrics.productRelationshipIntelligenceSummary).toMatchObject({
      source_product_id: PRODUCT_A,
      same_order_relationships: [
        expect.objectContaining({ related_product_id: PRODUCT_B }),
      ],
    });
  });

  it("keeps the repository read-only and scoped by tenant", async () => {
    const db = {
      productRiskSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          metrics: { productRelationshipIntelligenceSummary: { source_product_id: PRODUCT_A } },
        }),
      },
    };

    const summary = await getProductRelationshipSummaryForShop(SHOP, PRODUCT_A, db);

    expect(summary).toEqual({ source_product_id: PRODUCT_A });
    expect(db.productRiskSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shop: SHOP }),
      select: expect.objectContaining({ metrics: true }),
    }));
  });

  it("does not introduce Shopify mutations, direct Shopify calls, direct writes, or PII outputs", () => {
    const source = readFileSync(
      join(cwd(), "app/lib/product-pulse-product-relationships.server.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\bmutation\b|admin\.graphql|shopifyGraphql|write_/);
    expect(source).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\s*\(/);
    expect(source).not.toMatch(/email|phone|firstName|lastName|displayName/i);
  });
});
