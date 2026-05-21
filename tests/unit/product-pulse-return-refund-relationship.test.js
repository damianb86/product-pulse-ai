import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it, vi } from "vitest";
import { buildQuickScanCandidates } from "../../app/lib/product-pulse-quick-scan.server";
import {
  RETURN_REFUND_MATCH_CONFIDENCE,
  buildReturnRefundRelationshipSummary,
  classifyRelationshipReason,
  getProductReturnRefundRelationshipSummaryForShop,
} from "../../app/lib/product-pulse-return-refund-relationship.server";

const PRODUCT_ID = "gid://shopify/Product/return-product";
const VARIANT_ID = "gid://shopify/ProductVariant/return-variant";
const OTHER_PRODUCT_ID = "gid://shopify/Product/other-product";
const OTHER_VARIANT_ID = "gid://shopify/ProductVariant/other-variant";

function sale(overrides = {}) {
  return {
    type: "sale",
    shop: "shop-a.myshopify.com",
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    quantity: 1,
    amount: 100,
    occurredAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

function itemReturn(overrides = {}) {
  return {
    type: "return",
    shop: "shop-a.myshopify.com",
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    quantity: 1,
    reason: "SIZE_TOO_SMALL",
    occurredAt: "2026-05-05T10:00:00.000Z",
    ...overrides,
  };
}

function refund(overrides = {}) {
  return {
    type: "refund",
    shop: "shop-a.myshopify.com",
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    quantity: 1,
    amount: 100,
    reason: "Returned item restocked",
    occurredAt: "2026-05-06T10:00:00.000Z",
    ...overrides,
  };
}

function summaryFor(events, productId = PRODUCT_ID) {
  return buildReturnRefundRelationshipSummary({
    shop: "shop-a.myshopify.com",
    productId,
    products: [{
      id: PRODUCT_ID,
      variants: [{ id: VARIANT_ID }],
    }, {
      id: OTHER_PRODUCT_ID,
      variants: [{ id: OTHER_VARIANT_ID }],
    }],
    events,
  });
}

describe("return/refund relationship analysis", () => {
  it("matches return and refund by exact order line item with highest confidence", () => {
    const summary = summaryFor([
      sale({ quantity: 2, amount: 200 }),
      itemReturn(),
      refund(),
    ]);

    expect(summary).toMatchObject({
      sold_units: 2,
      sold_orders: 1,
      returned_units: 1,
      refunded_units: 1,
      returned_and_refunded_units: 1,
      returned_and_refunded_orders: 1,
      refund_amount_with_return: 100,
      relationship_match_confidence_avg: RETURN_REFUND_MATCH_CONFIDENCE.exactLineItem,
      relationship_match_confidence_min: RETURN_REFUND_MATCH_CONFIDENCE.exactLineItem,
    });
    expect(summary.relationship_buckets.no_return_no_refund.units).toBe(1);
    expect(summary.return_reason_categories).toMatchObject({ size_or_fit: 1 });
  });

  it("matches same order and same product or variant when the line item id is unavailable", () => {
    const summary = summaryFor([
      sale(),
      refund({ lineItemId: null, reason: "Customer request" }),
    ]);

    expect(summary.refunded_without_return_units).toBe(1);
    expect(summary.refunded_without_return_orders).toBe(1);
    expect(summary.relationship_match_confidence_avg).toBe(RETURN_REFUND_MATCH_CONFIDENCE.sameOrderProductVariant);
    expect(summary.refund_reason_categories).toMatchObject({ goodwill: 1 });
  });

  it("uses the single-product order fallback when no product or line id is present", () => {
    const summary = summaryFor([
      sale(),
      refund({
        productId: null,
        variantId: null,
        lineItemId: null,
        fallbackSource: "order_financial_status",
        reason: "Order-level refund",
      }),
    ]);

    expect(summary.refunded_without_return_units).toBe(1);
    expect(summary.attributed_refund_amount).toBe(100);
    expect(summary.relationship_match_confidence_avg).toBe(RETURN_REFUND_MATCH_CONFIDENCE.singleProductOrder);
  });

  it("keeps order-level multiproduct refunds unattributed instead of blaming a product", () => {
    const summary = summaryFor([
      sale(),
      sale({
        productId: OTHER_PRODUCT_ID,
        variantId: OTHER_VARIANT_ID,
        orderId: "gid://shopify/Order/1",
        lineItemId: "gid://shopify/LineItem/2",
        amount: 80,
      }),
      refund({
        fallbackSource: "order_financial_status",
        reason: "Order-level refund",
      }),
    ]);

    expect(summary.refunded_units).toBe(0);
    expect(summary.attributed_refund_amount).toBe(0);
    expect(summary.unattributed_refund_amount).toBe(100);
    expect(summary.relationship_unknown_count).toBe(1);
    expect(summary.relationship_match_confidence_min).toBe(RETURN_REFUND_MATCH_CONFIDENCE.unattributed);
    expect(summary.relationship_buckets.unattributed_refund.orders).toBe(1);
  });

  it("separates refund-without-return and return-without-refund rates", () => {
    const summary = summaryFor([
      sale({ orderId: "gid://shopify/Order/1", lineItemId: "gid://shopify/LineItem/1", quantity: 4, amount: 400 }),
      sale({ orderId: "gid://shopify/Order/2", lineItemId: "gid://shopify/LineItem/2", quantity: 1, amount: 100 }),
      itemReturn({ orderId: "gid://shopify/Order/1", lineItemId: "gid://shopify/LineItem/1", quantity: 2 }),
      refund({ orderId: "gid://shopify/Order/1", lineItemId: "gid://shopify/LineItem/1", amount: 100 }),
      refund({ orderId: "gid://shopify/Order/2", lineItemId: "gid://shopify/LineItem/2", amount: 100 }),
    ]);

    expect(summary).toMatchObject({
      sold_units: 5,
      sold_orders: 2,
      returned_units: 2,
      returned_orders: 1,
      refunded_units: 2,
      refunded_orders: 2,
      returned_and_refunded_units: 1,
      returned_not_refunded_units: 1,
      refunded_without_return_units: 1,
      attributed_refund_amount: 200,
      total_product_revenue: 500,
      return_rate_units: 0.4,
      return_rate_orders: 0.5,
      refund_rate_revenue: 0.4,
      return_to_refund_rate: 0.5,
      refund_without_return_rate: 0.2,
      return_without_refund_rate: 0.2,
    });
  });

  it("classifies exchange/replacement and pending return resolution only when source data supports it", () => {
    const exchangeSummary = summaryFor([
      sale(),
      itemReturn({ note: "Replacement requested by customer", reason: "EXCHANGE" }),
    ]);
    const pendingSummary = summaryFor([
      sale(),
      itemReturn({ status: "OPEN", reason: "CUSTOMER_RETURN_REQUESTED" }),
    ]);

    expect(exchangeSummary.exchange_or_replacement_units).toBe(1);
    expect(exchangeSummary.exchange_rate).toBe(1);
    expect(pendingSummary.pending_return_units).toBe(1);
    expect(pendingSummary.returned_not_refunded_units).toBe(0);
  });

  it("guards every derived rate against zero denominators", () => {
    const summary = summaryFor([
      itemReturn({ orderId: "gid://shopify/Order/no-sale", lineItemId: "gid://shopify/LineItem/no-sale" }),
    ]);

    expect(summary.sold_units).toBe(0);
    expect(summary.returned_units).toBe(1);
    expect(summary.return_rate_units).toBe(0);
    expect(summary.refund_rate_revenue).toBe(0);
    expect(summary.refund_attribution_rate).toBe(0);
    expect(Number.isFinite(summary.return_rate_units)).toBe(true);
  });

  it("ignores events from another shop when calculating a shop-scoped product summary", () => {
    const summary = summaryFor([
      sale(),
      refund({ shop: "other-shop.myshopify.com" }),
    ]);

    expect(summary.refunded_units).toBe(0);
    expect(summary.attributed_refund_amount).toBe(0);
    expect(summary.relationship_unknown_count).toBe(0);
  });

  it("stores the relationship summary and relationship-aware scoring factors on QuickScan candidate metrics", () => {
    const candidates = buildQuickScanCandidates({
      windowDays: 60,
      settings: { risk: { minimumScore: 0 }, momentum: { minimumScore: 101 } },
      products: [{
        id: PRODUCT_ID,
        handle: "return-product",
        title: "Return Product",
        variants: [{ id: VARIANT_ID, title: "Default Title", sku: "RET" }],
      }],
      events: [
        sale({ shop: null }),
        itemReturn({ shop: null }),
        refund({ shop: null }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].metrics.returnRefundRelationshipSummary).toMatchObject({
      product_id: PRODUCT_ID,
      returned_and_refunded_units: 1,
      relationship_match_confidence_avg: 1,
    });
    expect(candidates[0].metrics.returnRefundRelationshipFactors.productRisk.score).toBeGreaterThan(0);
  });

  it("keeps the repository read-only and scoped by tenant", async () => {
    const db = {
      productRiskSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          metrics: { returnRefundRelationshipSummary: { sold_units: 3 } },
        }),
      },
    };

    const summary = await getProductReturnRefundRelationshipSummaryForShop("shop-a.myshopify.com", PRODUCT_ID, db);

    expect(summary).toEqual({ sold_units: 3 });
    expect(db.productRiskSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shop: "shop-a.myshopify.com" }),
      select: expect.objectContaining({ metrics: true }),
    }));
  });

  it("does not introduce Shopify mutations or direct write calls", () => {
    const source = readFileSync(
      join(cwd(), "app/lib/product-pulse-return-refund-relationship.server.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\bmutation\b|admin\.graphql|shopifyGraphql|write_/);
    expect(source).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\s*\(/);
  });

  it("classifies available reason text into broad categories only from source fields", () => {
    expect(classifyRelationshipReason({ reason: "DAMAGED", note: "arrived broken" })).toBe("damaged_or_defective");
    expect(classifyRelationshipReason({ reason: "not as described" })).toBe("not_as_described");
    expect(classifyRelationshipReason({ note: "late carrier delivery" })).toBe("shipping_issue");
    expect(classifyRelationshipReason({ reason: "" })).toBe("");
  });
});
