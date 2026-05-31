import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it, vi } from "vitest";
import { buildQuickScanCandidates } from "../../app/lib/product-pulse-quick-scan.server";
import {
  DEFAULT_BULK_PURCHASE_THRESHOLD,
  PURCHASE_CONTEXT_BUCKETS,
  buildProductPurchaseContextSummary,
  getProductPurchaseContextSummaryForShop,
} from "../../app/lib/product-pulse-purchase-context.server";

const SHOP = "shop-a.myshopify.com";
const PRODUCT_A = "gid://shopify/Product/a";
const PRODUCT_B = "gid://shopify/Product/b";
const PRODUCT_C = "gid://shopify/Product/c";
const PRODUCT_D = "gid://shopify/Product/d";
const VARIANT_A_1 = "gid://shopify/ProductVariant/a-1";
const VARIANT_A_2 = "gid://shopify/ProductVariant/a-2";
const VARIANT_B = "gid://shopify/ProductVariant/b";
const VARIANT_C = "gid://shopify/ProductVariant/c";

function products() {
  return [
    { id: PRODUCT_A, title: "Product A", handle: "product-a", variants: [{ id: VARIANT_A_1 }, { id: VARIANT_A_2 }] },
    { id: PRODUCT_B, title: "Product B", handle: "product-b", variants: [{ id: VARIANT_B }] },
    { id: PRODUCT_C, title: "Product C", handle: "product-c", variants: [{ id: VARIANT_C }] },
    { id: PRODUCT_D, title: "Product D", handle: "product-d", variants: [] },
  ];
}

function sale(overrides = {}) {
  return {
    type: "sale",
    shop: SHOP,
    productId: PRODUCT_A,
    variantId: VARIANT_A_1,
    orderId: "order-1",
    lineItemId: "line-a-1",
    quantity: 1,
    amount: 100,
    orderDate: "2026-05-01T12:00:00.000Z",
    ...overrides,
  };
}

function summaryFor(events, productId = PRODUCT_A, options = {}) {
  return buildProductPurchaseContextSummary({
    shop: SHOP,
    productId,
    products: products(),
    events,
    assumeCompleteOrderEvents: true,
    ...options,
  });
}

describe("product purchase context analysis", () => {
  it("classifies solo, multi-product, single-unit, multi-unit, bulk, and multi-variant orders", () => {
    const events = [
      sale({ orderId: "order-1", lineItemId: "line-a-1", quantity: 1, amount: 100 }),
      sale({ orderId: "order-2", lineItemId: "line-a-2", quantity: 2, amount: 200 }),
      sale({ orderId: "order-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B, quantity: 1, amount: 40 }),
      sale({ orderId: "order-3", lineItemId: "line-a-3a", variantId: VARIANT_A_1, quantity: 2, amount: 200 }),
      sale({ orderId: "order-3", lineItemId: "line-a-3b", variantId: VARIANT_A_2, quantity: 1, amount: 90 }),
      sale({ orderId: "order-4", lineItemId: "line-a-4", quantity: 4, amount: 400 }),
      sale({ orderId: "order-4", lineItemId: "line-c-4", productId: PRODUCT_C, variantId: VARIANT_C, quantity: 1, amount: 60 }),
    ];

    const summary = summaryFor(events);

    expect(summary).toMatchObject({
      schema_version: 1,
      product_id: PRODUCT_A,
      total_orders_containing_product: 4,
      total_units_sold: 10,
      total_revenue_if_available: 990,
      solo_product_order_count: 2,
      multi_product_order_count: 2,
      single_unit_order_count: 1,
      multi_unit_order_count: 3,
      bulk_order_count: 1,
      multi_variant_order_count: 1,
      bulk_purchase_threshold: DEFAULT_BULK_PURCHASE_THRESHOLD,
      avg_product_quantity_per_order: 2.5,
      median_product_quantity_per_order: 2.5,
      avg_distinct_products_per_order: 1.5,
      avg_total_units_per_order: 3,
      solo_purchase_rate: 0.5,
      multi_product_basket_rate: 0.5,
      single_unit_purchase_rate: 0.25,
      multi_unit_purchase_rate: 0.75,
      bulk_purchase_rate: 0.25,
      multi_variant_order_rate: 0.25,
    });
    expect(summary.context_buckets[PURCHASE_CONTEXT_BUCKETS.soloProductOrder].orders).toBe(2);
    expect(summary.context_buckets[PURCHASE_CONTEXT_BUCKETS.multiVariantSameProductOrder].units).toBe(3);
  });

  it("keeps a quantity distribution because averages hide behavior", () => {
    const summary = summaryFor([
      sale({ orderId: "order-1", lineItemId: "line-a-1", quantity: 1 }),
      sale({ orderId: "order-2", lineItemId: "line-a-2", quantity: 2 }),
      sale({ orderId: "order-3", lineItemId: "line-a-3", quantity: 3 }),
      sale({ orderId: "order-4", lineItemId: "line-a-4", quantity: 7 }),
    ]);

    expect(summary.quantity_distribution).toEqual({
      one_unit_count: 1,
      two_unit_count: 1,
      three_unit_count: 1,
      four_plus_unit_count: 1,
      one_unit_rate: 0.25,
      two_unit_rate: 0.25,
      three_unit_rate: 0.25,
      four_plus_unit_rate: 0.25,
    });
  });

  it("ranks co-purchased products by affinity instead of raw best-seller frequency", () => {
    const summary = summaryFor([
      sale({ orderId: "order-1", lineItemId: "line-a-1" }),
      sale({ orderId: "order-2", lineItemId: "line-a-2" }),
      sale({ orderId: "order-2", lineItemId: "line-b-2", productId: PRODUCT_B, variantId: VARIANT_B }),
      sale({ orderId: "order-3", lineItemId: "line-a-3" }),
      sale({ orderId: "order-3", lineItemId: "line-c-3", productId: PRODUCT_C, variantId: VARIANT_C }),
      sale({ orderId: "order-4", lineItemId: "line-b-4", productId: PRODUCT_B, variantId: VARIANT_B }),
      sale({ orderId: "order-5", lineItemId: "line-b-5", productId: PRODUCT_B, variantId: VARIANT_B }),
    ]);

    expect(summary.top_co_purchased_products[0]).toMatchObject({
      productId: PRODUCT_C,
      title: "Product C",
      co_order_count: 1,
      co_order_rate: 0.3333,
      affinity_score: 1.6667,
    });
    expect(summary.top_co_purchased_products[1]).toMatchObject({
      productId: PRODUCT_B,
      co_order_count: 1,
      affinity_score: 0.5556,
    });
  });

  it("builds monthly order cohort context when order dates are available", () => {
    const summary = summaryFor([
      sale({ orderId: "may-1", lineItemId: "line-may-1", quantity: 1, orderDate: "2026-05-03T12:00:00.000Z" }),
      sale({ orderId: "may-2", lineItemId: "line-may-2", quantity: 3, orderDate: "2026-05-14T12:00:00.000Z" }),
      sale({ orderId: "jun-1", lineItemId: "line-jun-1", quantity: 4, orderDate: "2026-06-02T12:00:00.000Z" }),
      sale({ orderId: "jun-1", lineItemId: "line-jun-b", productId: PRODUCT_B, variantId: VARIANT_B, quantity: 1, orderDate: "2026-06-02T12:00:00.000Z" }),
    ]);

    expect(summary.monthly_context).toEqual([
      expect.objectContaining({
        month: "2026-05",
        orders_containing_product: 2,
        units_sold: 4,
        solo_product_orders: 2,
        avg_product_quantity_per_order: 2,
      }),
      expect.objectContaining({
        month: "2026-06",
        orders_containing_product: 1,
        units_sold: 4,
        multi_product_orders: 1,
        bulk_orders: 1,
      }),
    ]);
  });

  it("segments return and refund outcomes by basket, quantity, bulk, and multi-variant context", () => {
    const summary = summaryFor([
      sale({ orderId: "solo", lineItemId: "line-a-solo", quantity: 1, amount: 100 }),
      { type: "return", shop: SHOP, orderId: "solo", lineItemId: "line-a-solo", productId: PRODUCT_A, quantity: 1 },
      sale({ orderId: "basket", lineItemId: "line-a-basket", quantity: 2, amount: 200 }),
      sale({ orderId: "basket", lineItemId: "line-b-basket", productId: PRODUCT_B, variantId: VARIANT_B, quantity: 1, amount: 40 }),
      { type: "refund", shop: SHOP, orderId: "basket", lineItemId: "line-a-basket", productId: PRODUCT_A, quantity: 1, amount: 100 },
      sale({ orderId: "bulk", lineItemId: "line-a-bulk", quantity: 4, amount: 400 }),
      { type: "return", shop: SHOP, orderId: "bulk", lineItemId: "line-a-bulk", productId: PRODUCT_A, quantity: 2 },
      { type: "refund", shop: SHOP, orderId: "bulk", lineItemId: "line-a-bulk", productId: PRODUCT_A, quantity: 1, amount: 100 },
      sale({ orderId: "variant", lineItemId: "line-a-v1", variantId: VARIANT_A_1, quantity: 1, amount: 100 }),
      sale({ orderId: "variant", lineItemId: "line-a-v2", variantId: VARIANT_A_2, quantity: 1, amount: 90 }),
      { type: "return", shop: SHOP, orderId: "variant", lineItemId: "line-a-v2", productId: PRODUCT_A, variantId: VARIANT_A_2, quantity: 1 },
    ]);

    expect(summary.purchase_context_segments.bought_alone).toMatchObject({
      orders: 3,
      sold_units: 7,
      returned_units: 4,
      refunded_units: 1,
      refund_amount: 100,
    });
    expect(summary.purchase_context_segments.bought_with_others).toMatchObject({
      orders: 1,
      sold_units: 2,
      returned_units: 0,
      refunded_units: 1,
      refund_amount: 100,
    });
    expect(summary.purchase_context_segments.bulk_orders).toMatchObject({
      orders: 1,
      sold_units: 4,
      returned_units: 2,
      refunded_units: 1,
      refund_amount: 100,
    });
    expect(summary.purchase_context_segments.multi_variant_orders).toMatchObject({
      orders: 1,
      sold_units: 2,
      returned_units: 1,
    });
  });

  it("uses explicit basket line items for product-scoped diagnosis events", () => {
    const summary = buildProductPurchaseContextSummary({
      shop: SHOP,
      productId: PRODUCT_A,
      products: products(),
      assumeCompleteOrderEvents: false,
      sales: [
        sale({
          orderId: "diagnosis-order",
          lineItemId: "line-a",
          basketLineItems: [
            { lineItemId: "line-a", productId: PRODUCT_A, variantId: VARIANT_A_1, quantity: 1, amount: 100 },
            { lineItemId: "line-b", productId: PRODUCT_B, variantId: VARIANT_B, quantity: 2, amount: 80 },
          ],
        }),
      ],
    });

    expect(summary.multi_product_order_count).toBe(1);
    expect(summary.solo_product_order_count).toBe(0);
    expect(summary.unknown_or_incomplete_order_count).toBe(0);
    expect(summary.top_co_purchased_products[0]).toMatchObject({ productId: PRODUCT_B });
  });

  it("marks product-scoped sales without basket context as incomplete instead of pretending they are solo orders", () => {
    const summary = buildProductPurchaseContextSummary({
      shop: SHOP,
      productId: PRODUCT_A,
      products: products(),
      assumeCompleteOrderEvents: false,
      sales: [sale({ orderId: "unknown-basket", lineItemId: "line-a", quantity: 2 })],
    });

    expect(summary.total_orders_containing_product).toBe(1);
    expect(summary.total_units_sold).toBe(2);
    expect(summary.solo_product_order_count).toBe(0);
    expect(summary.multi_product_order_count).toBe(0);
    expect(summary.unknown_or_incomplete_order_count).toBe(1);
    expect(summary.purchase_context_confidence).toBeLessThan(50);
  });

  it("handles missing variant data without dropping valid product quantity metrics", () => {
    const summary = summaryFor([
      sale({ orderId: "variantless", lineItemId: "line-a", variantId: null, quantity: 2 }),
    ]);

    expect(summary.total_units_sold).toBe(2);
    expect(summary.multi_variant_order_count).toBe(0);
    expect(summary.purchase_context_confidence).toBeLessThan(90);
  });

  it("guards all rates against zero denominators", () => {
    const summary = summaryFor([], PRODUCT_D);

    expect(summary.total_orders_containing_product).toBe(0);
    expect(summary.solo_purchase_rate).toBe(0);
    expect(summary.multi_product_basket_rate).toBe(0);
    expect(summary.quantity_distribution.one_unit_rate).toBe(0);
    expect(Number.isFinite(summary.purchase_context_confidence)).toBe(true);
  });

  it("preserves tenant isolation", () => {
    const summary = summaryFor([
      sale({ shop: "other-shop.myshopify.com", orderId: "foreign", quantity: 5 }),
      sale({ shop: SHOP, orderId: "local", lineItemId: "local-line", quantity: 1 }),
    ]);

    expect(summary.total_orders_containing_product).toBe(1);
    expect(summary.total_units_sold).toBe(1);
  });

  it("stores the purchase context summary on Catalog Scan candidate metrics without changing scoring", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      settings: { risk: { minimumScore: 0 }, momentum: { minimumScore: 101 } },
      products: products(),
      events: [
        sale({ shop: null, orderId: "order-1", lineItemId: "line-a-1" }),
        sale({ shop: null, orderId: "order-1", lineItemId: "line-b-1", productId: PRODUCT_B, variantId: VARIANT_B }),
      ],
    });
    const productCandidate = candidates.find((candidate) => candidate.productGid === PRODUCT_A);

    expect(productCandidate?.metrics.productPurchaseContextSummary).toMatchObject({
      product_id: PRODUCT_A,
      total_orders_containing_product: 1,
      multi_product_order_count: 1,
    });
    expect(productCandidate?.metrics.returnRefundRelationshipSummary).toBeTruthy();
  });

  it("keeps the repository read-only and scoped by tenant", async () => {
    const db = {
      productRiskSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          metrics: { productPurchaseContextSummary: { total_orders_containing_product: 3 } },
        }),
      },
    };

    const summary = await getProductPurchaseContextSummaryForShop(SHOP, PRODUCT_A, db);

    expect(summary).toEqual({ total_orders_containing_product: 3 });
    expect(db.productRiskSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shop: SHOP }),
      select: expect.objectContaining({ metrics: true }),
    }));
  });

  it("does not introduce Shopify mutations or direct write calls", () => {
    const source = readFileSync(
      join(cwd(), "app/lib/product-pulse-purchase-context.server.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\bmutation\b|admin\.graphql|shopifyGraphql|write_/);
    expect(source).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\s*\(/);
  });
});
