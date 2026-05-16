import { describe, expect, it } from "vitest";
import {
  applyDraftAction,
  buildAnalyticsViewData,
  buildDashboardViewData,
  runCatalogSignalScan,
  startProductDiagnosis,
} from "../../app/lib/product-pulse-data";

describe("ProductPulse actions", () => {
  it("creates a running scan state", () => {
    expect(runCatalogSignalScan()).toMatchObject({
      status: "success",
      job: { status: "Running", progress: 8 },
    });
  });

  it("starts diagnosis and consumes one credit", () => {
    expect(startProductDiagnosis("core-linen-trouser", 3)).toMatchObject({
      status: "success",
      creditsRemaining: 2,
    });
  });

  it("blocks diagnosis without credits", () => {
    expect(startProductDiagnosis("core-linen-trouser", 0)).toMatchObject({
      status: "validation_error",
    });
  });

  it("validates draft action application", () => {
    expect(applyDraftAction("core-linen-trouser", "fit-note")).toMatchObject({ status: "success" });
    expect(applyDraftAction("core-linen-trouser", "missing")).toMatchObject({ status: "validation_error" });
  });

  it("reflects applied and dismissed action history in dashboard and analytics counts", () => {
    const product = {
      id: "gid://shopify/Product/1",
      handle: "test-product",
      title: "Test Product",
      riskScore: 67,
      confidence: 72,
      analysisDepth: "full",
      primaryIssue: "Product quality",
      metrics: {
        latestDiagnosisId: "diagnosis-1",
        marginAtRisk: 120,
        revenueAtRisk: 300,
        signalCount: 4,
      },
      recommendedActions: [
        { id: "rewrite-description", label: "Rewrite product description", type: "PDP copy", status: "Ready" },
        { id: "supplier-qa-review", label: "Supplier / QA review needed", type: "Workflow", status: "Ready" },
      ],
      actionHistory: [
        { id: "action-1", actionId: "rewrite-description", label: "Rewrite product description", status: "applied" },
        { id: "action-2", actionId: "supplier-qa-review", label: "Supplier / QA review needed", status: "dismissed" },
      ],
    };

    const dashboard = buildDashboardViewData([product]);
    const analytics = buildAnalyticsViewData([product]);

    expect(dashboard.totals.pendingActions).toBe(0);
    expect(dashboard.totals.appliedActions).toBe(1);
    expect(dashboard.actionQueue.total).toBe(0);
    expect(dashboard.kpis.find((kpi) => kpi.label === "Issues resolved / Risk reduced")).toMatchObject({
      value: "1",
      detail: "0 products resolved, 1 actions applied",
    });
    expect(analytics.actionPerformance).toMatchObject({
      suggested: 2,
      pending: 0,
      applied: 1,
      dismissed: 1,
    });
  });

  it("excludes equivalent handled actions from dashboard priority and queue links", () => {
    const handledProduct = {
      id: "gid://shopify/Product/handled",
      handle: "handled-product",
      title: "Handled Product",
      riskScore: 88,
      confidence: 75,
      analysisDepth: "full",
      primaryIssue: "Product quality",
      metrics: {
        latestDiagnosisId: "diagnosis-handled",
        marginAtRisk: 900,
        revenueAtRisk: 2200,
        signalCount: 8,
      },
      recommendedActions: [
        { id: "draft-pdp-copy", label: "Draft product quality note", type: "PDP copy", status: "Ready" },
      ],
      actionHistory: [
        { id: "action-handled", actionId: "rewrite-product-description", label: "Rewrite product description", status: "applied" },
      ],
    };
    const minorOnlyProduct = {
      id: "gid://shopify/Product/minor",
      handle: "minor-product",
      title: "Minor Product",
      riskScore: 92,
      confidence: 80,
      analysisDepth: "full",
      primaryIssue: "Product quality",
      metrics: {
        latestDiagnosisId: "diagnosis-minor",
        marginAtRisk: 1200,
        revenueAtRisk: 2600,
        signalCount: 9,
      },
      recommendedActions: [
        { id: "copy-support-note", label: "Share internal note with support team", type: "Internal note", status: "Ready" },
      ],
      actionHistory: [],
    };
    const actionableProduct = {
      id: "gid://shopify/Product/actionable",
      handle: "actionable-product",
      title: "Actionable Product",
      riskScore: 74,
      confidence: 70,
      analysisDepth: "full",
      primaryIssue: "Expectation mismatch",
      metrics: {
        latestDiagnosisId: "diagnosis-actionable",
        marginAtRisk: 500,
        revenueAtRisk: 1300,
        signalCount: 6,
      },
      recommendedActions: [
        { id: "create-product-faq", label: "Create product FAQ", type: "PDP copy", status: "Ready" },
      ],
      actionHistory: [],
    };

    const dashboard = buildDashboardViewData([handledProduct, minorOnlyProduct, actionableProduct]);

    expect(dashboard.totals.pendingActions).toBe(2);
    expect(dashboard.actionQueue.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Product FAQs", href: "/app/products/actionable-product" }),
      expect.objectContaining({ label: "Product quality notes", href: "/app/products/minor-product" }),
    ]));
    expect(dashboard.priorityProducts).toHaveLength(1);
    expect(dashboard.priorityProducts[0]).toMatchObject({
      title: "Actionable Product",
      actionLabel: "Create product FAQ",
    });
    expect(dashboard.startProduct).toMatchObject({
      title: "Actionable Product",
      actionTitle: "Create product FAQ",
    });
  });
});
