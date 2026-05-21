import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: vi.fn(),
}));

const {
  PRODUCT_PULSE_RECALCULATION_MAX_LIMIT,
  recomputeProductPulseMetricsForAllShops,
  recomputeProductPulseMetricsForProduct,
  recomputeProductPulseMetricsForShop,
  recalculateProductPulseSnapshotMetrics,
} = await import("../../app/lib/product-pulse-recalculation.server.js");

describe("ProductPulse relationship-aware recalculation", () => {
  it("recalculates one product snapshot and updates stored Product Risk", async () => {
    const snapshot = snapshotFor("shop-a.myshopify.com", "gid://shopify/Product/1", {
      riskScore: 5,
      metrics: metricsWithLinkedReturnRefunds(),
    });
    const db = createFakeDb([snapshot]);

    const result = await recomputeProductPulseMetricsForProduct("shop-a.myshopify.com", snapshot.productGid, { db });

    expect(result.updated).toBe(1);
    expect(db.productRiskSnapshot.findFirst).toHaveBeenCalledWith({
      where: { shop: "shop-a.myshopify.com", productGid: snapshot.productGid },
    });
    expect(db.productRiskSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { shop_productGid: { shop: "shop-a.myshopify.com", productGid: snapshot.productGid } },
    }));
    expect(db.updates[0].data.riskScore).toBeGreaterThan(snapshot.riskScore);
    expect(db.updates[0].data.metrics.scoringVersion).toBe(result.scoringVersion);
    expect(db.updates[0].data.metrics.returnRefundRelationshipFactors.productRisk.score).toBeGreaterThan(0);
  });

  it("recomputes one shop with tenant-scoped queries only", async () => {
    const shopSnapshot = snapshotFor("shop-a.myshopify.com", "gid://shopify/Product/1", { metrics: metricsWithLinkedReturnRefunds() });
    const otherShopSnapshot = snapshotFor("shop-b.myshopify.com", "gid://shopify/Product/1", { metrics: metricsWithLinkedReturnRefunds() });
    const db = createFakeDb([shopSnapshot, otherShopSnapshot]);

    const result = await recomputeProductPulseMetricsForShop("shop-a.myshopify.com", { db, limit: 10 });

    expect(result.found).toBe(1);
    expect(result.updated).toBe(1);
    expect(db.productRiskSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shop: "shop-a.myshopify.com" },
      take: 10,
    }));
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].where.shop_productGid.shop).toBe("shop-a.myshopify.com");
  });

  it("bounds all-shop recompute to avoid unbounded operations", async () => {
    const db = createFakeDb([
      snapshotFor("shop-a.myshopify.com", "gid://shopify/Product/1", { metrics: metricsWithLinkedReturnRefunds() }),
      snapshotFor("shop-b.myshopify.com", "gid://shopify/Product/2", { metrics: metricsWithLinkedReturnRefunds() }),
    ]);

    const result = await recomputeProductPulseMetricsForAllShops({ db, limit: 1000 });

    expect(db.productRiskSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: PRODUCT_PULSE_RECALCULATION_MAX_LIMIT,
    }));
    expect(result.updated).toBe(2);
  });

  it("logs recompute results when a job id is provided", async () => {
    const recordLog = vi.fn();
    const snapshot = snapshotFor("shop-a.myshopify.com", "gid://shopify/Product/1", { metrics: metricsWithLinkedReturnRefunds() });
    const db = createFakeDb([snapshot]);

    await recomputeProductPulseMetricsForProduct("shop-a.myshopify.com", snapshot.productGid, {
      db,
      jobId: "job-1",
      recordLog,
    });

    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({
      shop: "shop-a.myshopify.com",
      jobId: "job-1",
      event: "product_pulse_recompute.product_completed",
    }));
  });

  it("returns recalculated relationship-aware metrics without mutating the input snapshot", () => {
    const snapshot = snapshotFor("shop-a.myshopify.com", "gid://shopify/Product/1", {
      riskScore: 5,
      metrics: metricsWithLinkedReturnRefunds(),
    });

    const recalculated = recalculateProductPulseSnapshotMetrics(snapshot);

    expect(recalculated.riskScore).toBeGreaterThan(snapshot.riskScore);
    expect(recalculated.metrics.riskComponents.relationshipScore).toBeGreaterThan(0);
    expect(snapshot.metrics.scoringVersion).toBeUndefined();
  });

  it("does not contain Shopify mutations or direct Shopify write calls", () => {
    const source = readFileSync(
      join(cwd(), "app/lib/product-pulse-recalculation.server.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\bmutation\b|admin\.graphql|shopifyGraphql|write_/);
  });
});

function snapshotFor(shop, productGid, overrides = {}) {
  return {
    id: `${shop}:${productGid}`,
    shop,
    productGid,
    productTitle: "Relationship product",
    handle: "relationship-product",
    riskScore: 0,
    impactScore: 0,
    confidence: 0,
    primaryIssue: "Existing issue",
    sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
    metrics: {},
    calculatedAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

function metricsWithLinkedReturnRefunds() {
  return {
    soldUnits: 50,
    salesAmount: 5000,
    returnUnits: 6,
    refundUnits: 6,
    refundAmount: 600,
    sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
    returnRefundRelationshipSummary: {
      schema_version: 1,
      product_id: "gid://shopify/Product/1",
      sold_units: 50,
      sold_orders: 48,
      returned_units: 6,
      returned_orders: 6,
      refunded_units: 6,
      refunded_orders: 6,
      returned_and_refunded_units: 6,
      returned_and_refunded_orders: 6,
      returned_not_refunded_units: 0,
      returned_not_refunded_orders: 0,
      refunded_without_return_units: 0,
      refunded_without_return_orders: 0,
      exchange_or_replacement_units: 0,
      exchange_or_replacement_orders: 0,
      pending_return_units: 0,
      pending_return_orders: 0,
      unattributed_refund_amount: 0,
      attributed_refund_amount: 600,
      refund_amount_with_return: 600,
      refund_amount_without_return: 0,
      total_product_revenue: 5000,
      total_refund_amount_related_to_product_or_orders: 600,
      relationship_match_confidence_avg: 1,
      relationship_match_confidence_min: 1,
      relationship_unknown_count: 0,
      return_rate_units: 0.12,
      return_rate_orders: 0.125,
      refund_rate_revenue: 0.12,
      refund_rate_units: 0.12,
      return_to_refund_rate: 1,
      refund_with_return_rate: 1,
      refund_without_return_rate: 0,
      return_without_refund_rate: 0,
      exchange_rate: 0,
      unattributed_refund_rate: 0,
      refund_attribution_rate: 1,
      relationship_buckets: {
        unattributed_refund: { units: 0, orders: 0 },
      },
      return_reason_categories: { damaged_or_defective: 6 },
      refund_reason_categories: { damaged_or_defective: 6 },
    },
  };
}

function createFakeDb(snapshots = []) {
  const state = new Map(snapshots.map((snapshot) => [`${snapshot.shop}:${snapshot.productGid}`, snapshot]));
  const db = {
    updates: [],
    productRiskSnapshot: {
      findFirst: vi.fn(async ({ where }) => state.get(`${where.shop}:${where.productGid}`) || null),
      findMany: vi.fn(async ({ where = {}, take }) => Array.from(state.values())
        .filter((snapshot) => !where.shop || snapshot.shop === where.shop)
        .slice(0, take)),
      update: vi.fn(async ({ where, data }) => {
        const key = `${where.shop_productGid.shop}:${where.shop_productGid.productGid}`;
        const next = { ...state.get(key), ...data };
        state.set(key, next);
        db.updates.push({ where, data });
        return next;
      }),
    },
  };
  return db;
}
