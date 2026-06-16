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
        sale({
          orderId: "basket-2",
          lineItemId: "line-a-basket-2",
          basketLineItems: [
            { lineItemId: "line-a-basket-2", productId: PRODUCT_A, variantId: VARIANT_A, title: "Product A", handle: "product-a", quantity: 1, amount: 100 },
            { lineItemId: "line-b-basket-2", productId: PRODUCT_B, variantId: VARIANT_B, title: "Shopify Related Product", handle: "shopify-related-product", imageUrl: "https://cdn.example/shopify-related.jpg", quantity: 1, amount: 40 },
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

  it("does not expose same-order relationships from one order or one known customer", () => {
    const oneOrderSummary = summaryFor([
      sale({ orderId: "single-a-b", lineItemId: "line-single-a" }),
      sale({ orderId: "single-a-b", lineItemId: "line-single-b", productId: PRODUCT_B, variantId: VARIANT_B }),
      sale({ orderId: "source-only", lineItemId: "line-source-only" }),
    ]);

    expect(oneOrderSummary.top_bought_together).toEqual([]);

    const oneCustomerSummary = summaryFor([
      sale({ orderId: "same-customer-1", lineItemId: "line-a-1", customerKey: "customer-1" }),
      sale({ orderId: "same-customer-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1" }),
      sale({ orderId: "same-customer-2", lineItemId: "line-a-2", customerKey: "customer-1", orderDate: "2026-05-02T12:00:00.000Z" }),
      sale({ orderId: "same-customer-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-02T12:00:00.000Z" }),
    ]);

    expect(oneCustomerSummary.top_bought_together).toEqual([]);
  });

  it("requires relationship support to scale with product and shop volume", () => {
    const sparseHighVolumeEvents = Array.from({ length: 1000 }, (_, index) => {
      const orderNumber = index + 1;
      const orderId = `high-volume-${orderNumber}`;
      const rows = [sale({ orderId, lineItemId: `line-a-${orderNumber}`, orderDate: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z` })];
      if (index < 3) rows.push(sale({ orderId, lineItemId: `line-b-${orderNumber}`, productId: PRODUCT_B, variantId: VARIANT_B, orderDate: rows[0].orderDate }));
      return rows;
    }).flat();
    const supportedHighVolumeEvents = Array.from({ length: 1000 }, (_, index) => {
      const orderNumber = index + 1;
      const orderId = `supported-volume-${orderNumber}`;
      const rows = [sale({ orderId, lineItemId: `line-supported-a-${orderNumber}`, orderDate: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z` })];
      if (index < 20) rows.push(sale({ orderId, lineItemId: `line-supported-b-${orderNumber}`, productId: PRODUCT_B, variantId: VARIANT_B, orderDate: rows[0].orderDate }));
      return rows;
    }).flat();

    const sparseSummary = summaryFor(sparseHighVolumeEvents);
    const supportedSummary = summaryFor(supportedHighVolumeEvents);

    expect(sparseSummary.data_basis.relationship_support_thresholds.same_order_min_order_count).toBe(20);
    expect(sparseSummary.top_bought_together).toEqual([]);
    expect(supportedSummary.top_bought_together[0]).toMatchObject({
      related_product_id: PRODUCT_B,
      co_order_count: 20,
    });
  });

  it("calculates previous-purchase and next-purchase directional relationships by customer window", () => {
    const summary = summaryFor([
      sale({ orderId: "c1-before", lineItemId: "line-c1-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "c1-source", lineItemId: "line-c1-a", customerKey: "customer-1", orderDate: "2026-05-10T12:00:00.000Z" }),
      sale({ orderId: "c1-after", lineItemId: "line-c1-c", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-1", amount: 70, orderDate: "2026-05-20T12:00:00.000Z" }),
      sale({ orderId: "c2-before", lineItemId: "line-c2-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "c2-source", lineItemId: "line-c2-a", customerKey: "customer-2", orderDate: "2026-05-18T12:00:00.000Z" }),
      sale({ orderId: "c2-after", lineItemId: "line-c2-c", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-2", amount: 70, orderDate: "2026-05-28T12:00:00.000Z" }),
      sale({ orderId: "c3-source", lineItemId: "line-c3-a", customerKey: "customer-3", orderDate: "2026-05-18T12:00:00.000Z" }),
    ]);

    const previous30 = summary.previous_purchase_relationships.find((item) => item.related_product_id === PRODUCT_B && item.time_window === "30d_before");
    const next30 = summary.next_purchase_relationships.find((item) => item.related_product_id === PRODUCT_C && item.time_window === "30d_after");

    expect(previous30).toMatchObject({
      relationship_direction: "before",
      customer_count: 2,
      relationship_rate: 0.6667,
      median_days_before: 12,
    });
    expect(next30).toMatchObject({
      relationship_direction: "after",
      customer_count: 2,
      relationship_rate: 0.6667,
      avg_days_after: 10,
      follow_on_revenue: 140,
    });
  });

  it("uses unique customers for monthly previous and next purchase relationship rates", () => {
    const summary = summaryFor([
      sale({ orderId: "c1-before-1", lineItemId: "line-c1-b-1", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "c1-before-2", lineItemId: "line-c1-b-2", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-02T12:00:00.000Z" }),
      sale({ orderId: "c1-source", lineItemId: "line-c1-a", customerKey: "customer-1", orderDate: "2026-05-10T12:00:00.000Z" }),
      sale({ orderId: "c1-after-1", lineItemId: "line-c1-c-1", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-1", amount: 70, orderDate: "2026-05-20T12:00:00.000Z" }),
      sale({ orderId: "c1-after-2", lineItemId: "line-c1-c-2", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-1", amount: 70, orderDate: "2026-05-25T12:00:00.000Z" }),
      sale({ orderId: "c2-before", lineItemId: "line-c2-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "c2-source", lineItemId: "line-c2-a", customerKey: "customer-2", orderDate: "2026-05-12T12:00:00.000Z" }),
      sale({ orderId: "c2-after", lineItemId: "line-c2-c", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-2", amount: 70, orderDate: "2026-05-22T12:00:00.000Z" }),
    ]);

    const previous30 = summary.previous_purchase_relationships.find((item) => item.related_product_id === PRODUCT_B && item.time_window === "30d_before");
    const next30 = summary.next_purchase_relationships.find((item) => item.related_product_id === PRODUCT_C && item.time_window === "30d_after");

    expect(previous30.monthly).toContainEqual(expect.objectContaining({
      month: "2026-05",
      source_product_orders: 2,
      source_product_customers: 2,
      related_order_count: 3,
      related_customer_count: 2,
      customer_count: 2,
      relationship_rate: 1,
    }));
    expect(next30.monthly).toContainEqual(expect.objectContaining({
      month: "2026-05",
      source_product_orders: 2,
      source_product_customers: 2,
      related_order_count: 3,
      related_customer_count: 2,
      customer_count: 2,
      relationship_rate: 1,
    }));
  });

  it("dedupes sequence timing windows before applying the top limit", () => {
    const events = [
      sale({ orderId: "b-a-source", lineItemId: "line-b-a-source", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "b-a-after", lineItemId: "line-a-after", productId: PRODUCT_A, variantId: VARIANT_A, customerKey: "customer-1", orderDate: "2026-05-20T12:00:00.000Z" }),
      sale({ orderId: "b-a-source-2", lineItemId: "line-b-a-source-2", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-4", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "b-a-after-2", lineItemId: "line-a-after-2", productId: PRODUCT_A, variantId: VARIANT_A, customerKey: "customer-4", orderDate: "2026-05-20T12:00:00.000Z" }),
      sale({ orderId: "b-c-source-1", lineItemId: "line-b-c-source-1", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "b-c-after-1", lineItemId: "line-c-after-1", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-2", orderDate: "2026-05-10T12:00:00.000Z" }),
      sale({ orderId: "b-c-source-2", lineItemId: "line-b-c-source-2", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-3", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "b-c-after-2", lineItemId: "line-c-after-2", productId: PRODUCT_C, variantId: VARIANT_C, customerKey: "customer-3", orderDate: "2026-05-20T12:00:00.000Z" }),
    ];

    const summaryA = summaryFor(events, PRODUCT_A, { topRelationshipLimit: 2 });
    const summaryB = summaryFor(events, PRODUCT_B, { topRelationshipLimit: 2 });
    const afterIds = summaryB.next_purchase_relationships.map((item) => item.related_product_id);

    expect(summaryA.previous_purchase_relationships.some((item) => item.related_product_id === PRODUCT_B)).toBe(true);
    expect(afterIds).toContain(PRODUCT_A);
    expect(afterIds.filter((id) => id === PRODUCT_C)).toHaveLength(1);
    expect(summaryB.next_purchase_relationships.find((item) => item.related_product_id === PRODUCT_A)).toMatchObject({
      relationship_direction: "after",
      time_window: "30d_after",
      customer_count: 2,
    });
  });

  it("keeps directionality distinct for A to B after versus B to A after", () => {
    const events = [
      sale({ orderId: "first", lineItemId: "line-a-first", customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "second", lineItemId: "line-b-second", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-05T12:00:00.000Z" }),
      sale({ orderId: "third", lineItemId: "line-a-third", customerKey: "customer-2", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "fourth", lineItemId: "line-b-fourth", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-05T12:00:00.000Z" }),
    ];

    const summaryA = summaryFor(events, PRODUCT_A);
    const summaryB = summaryFor(events, PRODUCT_B);

    expect(summaryA.next_purchase_relationships.some((item) => item.related_product_id === PRODUCT_B)).toBe(true);
    expect(summaryB.next_purchase_relationships.some((item) => item.related_product_id === PRODUCT_A)).toBe(false);
    expect(summaryB.previous_purchase_relationships.some((item) => item.related_product_id === PRODUCT_A)).toBe(true);
  });

  it("does not expose sequence relationships from a single customer", () => {
    const summary = summaryFor([
      sale({ orderId: "single-source", lineItemId: "line-single-a", customerKey: "customer-1", orderDate: "2026-05-01T12:00:00.000Z" }),
      sale({ orderId: "single-after", lineItemId: "line-single-b", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-05T12:00:00.000Z" }),
    ]);

    expect(summary.next_purchase_relationships).toEqual([]);
    expect(summary.previous_purchase_relationships).toEqual([]);
  });

  it("groups relationship trends by source product cohort month and classifies emerging trends", () => {
    const summary = summaryFor([
      sale({ orderId: "may-a", lineItemId: "line-may-a", orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "jun-a", lineItemId: "line-jun-a", orderDate: "2026-06-03T12:00:00.000Z" }),
      sale({ orderId: "jun-a", lineItemId: "line-jun-b", productId: PRODUCT_B, variantId: VARIANT_B, orderDate: "2026-06-03T12:00:00.000Z" }),
      sale({ orderId: "jun-a-2", lineItemId: "line-jun-a-2", orderDate: "2026-06-10T12:00:00.000Z" }),
      sale({ orderId: "jun-a-2", lineItemId: "line-jun-b-2", productId: PRODUCT_B, variantId: VARIANT_B, orderDate: "2026-06-10T12:00:00.000Z" }),
    ]);

    const relationship = summary.same_order_relationships.find((item) => item.related_product_id === PRODUCT_B);

    expect(relationship.monthly).toEqual([
      expect.objectContaining({ month: "2026-05", source_product_orders: 1, related_order_count: 0 }),
      expect.objectContaining({ month: "2026-06", source_product_orders: 2, related_order_count: 2, relationship_rate: 1 }),
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
      sale({ orderId: "dom-4", lineItemId: "line-a-4", customerKey: "customer-1", orderDate: "2026-05-04T12:00:00.000Z" }),
      sale({ orderId: "dom-4", lineItemId: "line-b-4", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-1", orderDate: "2026-05-04T12:00:00.000Z" }),
      sale({ orderId: "dom-5", lineItemId: "line-a-5", customerKey: "customer-2", orderDate: "2026-05-05T12:00:00.000Z" }),
      sale({ orderId: "dom-5", lineItemId: "line-b-5", productId: PRODUCT_B, variantId: VARIANT_B, customerKey: "customer-2", orderDate: "2026-05-05T12:00:00.000Z" }),
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
      sale({ orderId: "together", lineItemId: "line-a-together", quantity: 1, amount: 100 }),
      sale({ orderId: "together", lineItemId: "line-b-together", productId: PRODUCT_B, variantId: VARIANT_B, amount: 40 }),
      itemReturn({ orderId: "together", lineItemId: "line-a-together", quantity: 1 }),
      refund({ orderId: "together", lineItemId: "line-a-together", quantity: 1, amount: 100 }),
      sale({ orderId: "together-2", lineItemId: "line-a-together-2", quantity: 1, amount: 100 }),
      sale({ orderId: "together-2", lineItemId: "line-b-together-2", productId: PRODUCT_B, variantId: VARIANT_B, amount: 40 }),
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

  it("stores product relationship intelligence on Catalog Scan candidate metrics", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 90,
      settings: { risk: { minimumScore: 0 }, momentum: { minimumScore: 101 } },
      products: products(),
      events: [
        sale({ shop: null, orderId: "order-1", lineItemId: "line-a-1" }),
        sale({ shop: null, orderId: "order-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B }),
        sale({ shop: null, orderId: "order-2", lineItemId: "line-a-2" }),
        sale({ shop: null, orderId: "order-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B }),
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
