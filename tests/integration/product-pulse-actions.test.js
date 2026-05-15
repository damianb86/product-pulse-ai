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
});
