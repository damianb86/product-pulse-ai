import { describe, expect, it } from "vitest";
import {
  applyDraftAction,
  buildAnalyticsViewData,
  buildDashboardViewData,
  runCatalogSignalScan,
  startProductDiagnosis,
} from "../../app/lib/product-pulse-data";
import { __productPulseDiagnosisTestHooks as diagnosisHooks } from "../../app/lib/product-pulse-diagnosis.server";

describe("ProductPulse actions", () => {
  it("creates a running scan state", () => {
    expect(runCatalogSignalScan()).toMatchObject({
      status: "success",
      job: { status: "Running", progress: 8 },
    });
  });

  it("starts diagnosis and consumes one diagnosis credit", () => {
    expect(startProductDiagnosis("core-linen-trouser", 3)).toMatchObject({
      status: "success",
      creditsRemaining: 2,
    });
  });

  it("blocks diagnosis without diagnosis credits", () => {
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

  it("calculates action effectiveness from stored product risk history", () => {
    const product = {
      id: "gid://shopify/Product/effectiveness",
      handle: "effectiveness-product",
      title: "Effectiveness Product",
      riskScore: 58,
      confidence: 80,
      analysisDepth: "full",
      primaryIssue: "Product quality",
      metrics: {
        latestDiagnosisId: "diagnosis-effectiveness",
        returnRate: 7,
        marginAtRisk: 240,
        revenueAtRisk: 600,
        signalCount: 6,
        riskHistory: [
          {
            riskScore: 82,
            returnRate: 14,
            marginAtRisk: 520,
            recordedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
      recommendedActions: [
        { id: "rewrite-description", label: "Rewrite product description", type: "PDP copy", status: "Ready" },
      ],
      actionHistory: [
        {
          id: "action-effectiveness-1",
          actionId: "rewrite-description",
          label: "Rewrite product description",
          status: "applied",
          appliedAt: "2026-04-15T00:00:00.000Z",
        },
      ],
    };

    const analytics = buildAnalyticsViewData([product]);

    expect(analytics.actionPerformance.effectiveness).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Product risk change", value: "Down 24 pts" }),
      expect.objectContaining({ label: "Post-fix return rate", value: "Down 7 pts" }),
      expect.objectContaining({ label: "Estimated Margin Exposure reduced", value: "$280 lower" }),
    ]));
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

  it("does not count one applied metadata action as every metadata recommendation", () => {
    const product = {
      id: "gid://shopify/Product/meta",
      handle: "meta-product",
      title: "Meta Product",
      riskScore: 71,
      confidence: 76,
      analysisDepth: "full",
      primaryIssue: "Product content",
      metrics: {
        latestDiagnosisId: "diagnosis-meta",
        marginAtRisk: 300,
        revenueAtRisk: 900,
        signalCount: 7,
      },
      recommendedActions: [
        { id: "rewrite-meta-description", label: "Rewrite meta description", type: "SEO", status: "Ready" },
        { id: "rewrite-seo-title", label: "Rewrite SEO title", type: "SEO", status: "Ready" },
      ],
      actionHistory: [
        {
          id: "action-meta",
          actionId: "rewrite-meta-description",
          label: "Rewrite meta description",
          status: "applied",
        },
      ],
    };

    const dashboard = buildDashboardViewData([product]);
    const analytics = buildAnalyticsViewData([product]);

    expect(dashboard.totals.pendingActions).toBe(1);
    expect(dashboard.totals.appliedActions).toBe(1);
    expect(dashboard.actionQueue.total).toBe(1);
    expect(analytics.actionPerformance).toMatchObject({
      suggested: 2,
      pending: 1,
      applied: 1,
    });
  });

  it("does not count one applied same-label action as every same-label recommendation", () => {
    const product = {
      id: "gid://shopify/Product/faq",
      handle: "faq-product",
      title: "FAQ Product",
      riskScore: 74,
      confidence: 82,
      analysisDepth: "full",
      primaryIssue: "Product content",
      metrics: {
        latestDiagnosisId: "diagnosis-faq",
        marginAtRisk: 260,
        revenueAtRisk: 780,
        signalCount: 10,
      },
      recommendedActions: [
        { id: "create-fit-faq", label: "Create product FAQ", type: "PDP copy", status: "Ready" },
        { id: "create-compatibility-faq", label: "Create product FAQ", type: "PDP copy", status: "Ready" },
      ],
      actionHistory: [
        {
          id: "stored-create-fit-faq",
          actionId: "create-fit-faq",
          label: "Create product FAQ",
          status: "applied",
          payload: { actionAliases: ["create-product-faq"] },
        },
      ],
    };

    const dashboard = buildDashboardViewData([product]);
    const analytics = buildAnalyticsViewData([product]);

    expect(dashboard.totals.pendingActions).toBe(1);
    expect(dashboard.totals.appliedActions).toBe(1);
    expect(dashboard.actionQueue.total).toBe(1);
    expect(analytics.actionPerformance).toMatchObject({
      suggested: 2,
      pending: 1,
      applied: 1,
    });
  });

  it("keeps a repeated recommendation open when the matching action belongs to an older diagnosis", () => {
    const product = {
      id: "gid://shopify/Product/reanalyzed",
      handle: "reanalyzed-product",
      title: "Reanalyzed Product",
      riskScore: 78,
      confidence: 84,
      analysisDepth: "full",
      primaryIssue: "Product content",
      metrics: {
        latestDiagnosisId: "diagnosis-new",
        marginAtRisk: 420,
        revenueAtRisk: 1100,
        signalCount: 9,
      },
      recommendedActions: [
        { id: "rewrite-description", label: "Rewrite product description", type: "PDP copy", status: "Ready" },
      ],
      actionHistory: [
        {
          id: "action-old-rewrite",
          diagnosisId: "diagnosis-old",
          actionId: "rewrite-description",
          label: "Rewrite product description",
          status: "applied",
        },
      ],
    };

    const dashboard = buildDashboardViewData([product]);
    const analytics = buildAnalyticsViewData([product]);

    expect(dashboard.totals.pendingActions).toBe(1);
    expect(dashboard.totals.appliedActions).toBe(1);
    expect(dashboard.actionQueue.total).toBe(1);
    expect(analytics.actionPerformance).toMatchObject({
      suggested: 2,
      pending: 1,
      applied: 1,
    });
  });

  it("prioritizes product-change actions over investigation-only actions on the dashboard", () => {
    const investigationOnlyProduct = {
      id: "gid://shopify/Product/investigate",
      handle: "investigate-product",
      title: "Investigation Product",
      riskScore: 96,
      confidence: 86,
      analysisDepth: "full",
      primaryIssue: "Source integrity",
      metrics: {
        latestDiagnosisId: "diagnosis-investigate",
        marginAtRisk: 1800,
        productMomentumScore: 92,
        signalCount: 11,
      },
      recommendedActions: [
        { id: "review-product-evidence", label: "Review product evidence", type: "Workflow", status: "Ready" },
      ],
      actionHistory: [],
    };
    const customerFacingProduct = {
      id: "gid://shopify/Product/customer-facing",
      handle: "customer-facing-product",
      title: "Customer Facing Product",
      riskScore: 68,
      confidence: 74,
      analysisDepth: "full",
      primaryIssue: "Expectation mismatch",
      metrics: {
        latestDiagnosisId: "diagnosis-customer-facing",
        marginAtRisk: 450,
        productMomentumScore: 78,
        signalCount: 5,
      },
      recommendedActions: [
        {
          id: "update-description",
          label: "Update product description",
          type: "PDP copy",
          status: "Ready",
          payload: { draftText: "Add clear expectation-setting copy to the product page." },
        },
      ],
      actionHistory: [],
    };

    const dashboard = buildDashboardViewData([investigationOnlyProduct, customerFacingProduct]);

    expect(dashboard.actionQueue.total).toBe(2);
    expect(dashboard.startProduct).toMatchObject({
      title: "Customer Facing Product",
      actionTitle: "Update product description",
    });
    expect(dashboard.priorityProducts).toHaveLength(1);
    expect(dashboard.priorityProducts[0]).toMatchObject({
      title: "Customer Facing Product",
      actionLabel: "Update product description",
    });
  });

  it("uses configured analysis lookback for analytics trend windows", () => {
    const product = {
      id: "gid://shopify/Product/window",
      handle: "windowed-product",
      title: "Windowed Product",
      riskScore: 64,
      analysisDepth: "full",
      lastAnalysis: "2026-05-20T00:00:00.000Z",
      metrics: {
        marginAtRisk: 900,
        revenueAtRisk: 1800,
        riskTrend: [40, 55, 64],
        windowDays: 180,
      },
    };

    const analytics = buildAnalyticsViewData([product], {
      settings: { analysis: { lookbackDays: 45 } },
    });

    expect(analytics.windowDays).toBe(45);
    expect(analytics.windowLabel).toBe("Last 45 days");
    expect(analytics.impactTrend.labels[0]).toBe("Apr 5");
    expect(analytics.impactTrend.labels.at(-1)).toBe("May 20");
  });

  it("builds analytics chart data from Product Diagnosis products only", () => {
    const fullDiagnosisProduct = {
      id: "gid://shopify/Product/deep",
      handle: "deep-product",
      title: "Deep Product",
      riskScore: 82,
      confidence: 91,
      analysisDepth: "full",
      primaryIssue: "Product quality",
      lastAnalysis: "2026-05-20T00:00:00.000Z",
      metrics: {
        latestDiagnosisId: "diagnosis-deep",
        returnRate: 7,
        marginAtRisk: 1000,
        revenueAtRisk: 4000,
        signalCount: 4,
        returnUnits: 2,
        refundUnits: 1,
        reviewCount: 5,
        csvReviewCount: 2,
        soldUnits: 10,
        contentIssueCount: 2,
        riskHistory: [
          { recordedAt: "2026-05-01T00:00:00.000Z", riskScore: 90, returnRate: 12, marginAtRisk: 1400, revenueAtRisk: 5200 },
          { recordedAt: "2026-05-20T00:00:00.000Z", riskScore: 82, returnRate: 7, marginAtRisk: 1000, revenueAtRisk: 4000 },
        ],
      },
      actionHistory: [
        {
          id: "action-impact-1",
          actionId: "rewrite-description",
          label: "Rewrite description",
          status: "applied",
          appliedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    };
    const quickScanProduct = {
      id: "gid://shopify/Product/quick",
      handle: "quick-product",
      title: "Quick Product",
      riskScore: 90,
      analysisDepth: "quickscan",
      primaryIssue: "Refund impact",
      metrics: {
        marginAtRisk: 9000,
        revenueAtRisk: 30000,
        signalCount: 20,
        returnUnits: 12,
        refundUnits: 8,
        reviewCount: 40,
        soldUnits: 50,
      },
    };

    const analytics = buildAnalyticsViewData([fullDiagnosisProduct, quickScanProduct]);
    const trendSeries = analytics.deepDiagnosisCharts.riskMarginTrend.series;
    const actionImpactSeries = analytics.actionImpactTrend.series;

    expect(analytics.deepDiagnosisCharts.productCount).toBe(1);
    expect(trendSeries.find((series) => series.key === "marginAtRisk").values.at(-1)).toBe(1000);
    expect(trendSeries.find((series) => series.key === "revenueAtRisk").values.at(-1)).toBe(4000);
    expect(analytics.deepDiagnosisCharts.issueDistribution.rows[0]).toMatchObject({
      label: "Product quality",
      count: 4,
    });
    expect(analytics.deepDiagnosisCharts.sourceCoverageMix.rows.map((row) => row.label)).toEqual(expect.arrayContaining([
      "Orders",
      "Reviews",
      "CSV Reviews",
      "Returns",
      "Refunds",
      "Product content",
    ]));
    expect(analytics.deepDiagnosisCharts.sourceCoverageMix.total).toBe(20);
    expect(actionImpactSeries.find((series) => series.key === "actionsApplied").values.at(-1)).toBe(1);
    expect(actionImpactSeries.find((series) => series.key === "reducedRiskUsd").values.at(-1)).toBe(400);
    expect(actionImpactSeries.find((series) => series.key === "reducedReturns").values.at(-1)).toBe(5);
  });

  it("builds analytics risk, margin, and issue charts from retroactive score history", () => {
    const analytics = buildAnalyticsViewData([{
      id: "gid://shopify/Product/retroactive",
      handle: "retroactive-product",
      title: "Retroactive Product",
      riskScore: 80,
      confidence: 90,
      analysisDepth: "full",
      primaryIssue: "Current issue should not replace historical mix",
      lastAnalysis: "2026-05-20T00:00:00.000Z",
      metrics: {
        latestDiagnosisId: "diagnosis-retroactive",
        marginAtRisk: 800,
        revenueAtRisk: 2000,
        signalCount: 99,
        riskHistory: [
          {
            recordedAt: "2025-06-30T00:00:00.000Z",
            riskScore: 40,
            marginAtRisk: 100,
            revenueAtRisk: 300,
            primaryIssue: "Return pressure",
            signalCount: 2,
          },
          {
            recordedAt: "2025-12-31T00:00:00.000Z",
            riskScore: 72,
            marginAtRisk: 500,
            revenueAtRisk: 1500,
            primaryIssue: "Product quality",
            signalCount: 5,
          },
          {
            recordedAt: "2026-05-20T00:00:00.000Z",
            riskScore: 80,
            marginAtRisk: 800,
            revenueAtRisk: 2000,
            primaryIssue: "Product quality",
            signalCount: 6,
          },
        ],
      },
    }]);

    const trend = analytics.deepDiagnosisCharts.riskMarginTrend;
    expect(trend.labels).toEqual(["Jun 30", "Dec 31", "May 20"]);
    expect(trend.detail).toContain("saved score-history exposure");
    expect(trend.series.find((series) => series.key === "marginAtRisk").values).toEqual([100, 500, 800]);
    expect(trend.series.find((series) => series.key === "revenueAtRisk").values).toEqual([300, 1500, 2000]);
    expect(analytics.deepDiagnosisCharts.issueDistribution.rows[0]).toMatchObject({
      label: "Product quality",
      count: 11,
    });
    expect(analytics.deepDiagnosisCharts.issueDistribution.rows[1]).toMatchObject({
      label: "Return pressure",
      count: 2,
    });
    expect(analytics.issueImpact.rows[0]).toMatchObject({
      label: "Product quality",
      signalCount: 11,
      productsAffected: 1,
    });
  });

  it("creates expanded recommended action recipes with impact tiers", () => {
    const product = {
      id: "gid://shopify/Product/action-recipes",
      numericId: "1",
      title: "Sample Console Bundle",
      handle: "product-123",
      description: "A short console bundle.",
      descriptionHtml: "<p>A short console bundle.</p>",
      seoTitle: "",
      seoDescription: "",
      vendor: "",
      productType: "",
      tags: ["console"],
      collections: ["Gaming"],
      options: [],
      variants: [{ id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "SKU1" }],
      media: [{ id: "gid://shopify/MediaImage/1", alt: "", mediaContentType: "IMAGE" }],
    };
    const content = diagnosisHooks.analyzeProductContentDeterministically(product);
    const deterministic = {
      product,
      mainIssue: "product_content",
      mainIssueLabel: "Product content",
      riskScore: 62,
      confidence: 71,
      estimatedImpact: { marginAtRisk: 120, revenueAtRisk: 300 },
      issueSignalCounts: { product_content: 2 },
      evidenceSnippets: [],
      sourceCoverage: ["Shopify product", "Shopify orders"],
      metrics: {
        contentAnalysis: content,
        contentIssues: content.issues,
        contentAdvisories: content.advisories,
        contentIssueCount: content.issues.length,
        contentAdvisoryCount: content.advisories.length,
        contentQualityScore: content.score,
        customerSignalCount: 2,
        signalCount: 3,
        returnUnits: 2,
        refundUnits: 0,
        negativeReviewCount: 0,
        reviewCount: 0,
        productMomentumScore: 84,
        returnRate: 12,
        refundRate: 0,
        marginAtRisk: 120,
        topReturnReasons: ["Not as described"],
        topReturnReasonDetails: [{ label: "Not as described", count: 2 }],
        topRefundReasons: [],
        affectedVariants: [],
        affectedVariantDetails: [],
        variants: product.variants,
        mediaCount: content.mediaCount,
        mediaWithoutAltCount: content.mediaWithoutAltCount,
        titleNeedsReview: content.titleNeedsReview,
        seoTitleNeedsReview: content.seoTitleNeedsReview,
        metaDescriptionNeedsReview: content.metaDescriptionNeedsReview,
        handleNeedsReview: content.handleNeedsReview,
        specsBlockRecommended: content.specsBlockRecommended,
        classificationNeedsReview: content.classificationNeedsReview,
        catalogProductTypes: ["Game console", "Puzzle", "Wall Art"],
        templateNeedsReview: content.templateNeedsReview,
        faqNeed: { shouldRecommend: false },
        textInsights: {},
        refundInsights: {},
      },
    };

    const recommendations = diagnosisHooks.buildFinalRecommendations({
      snapshot: {
        productGid: product.id,
        productTitle: product.title,
        handle: product.handle,
      },
      deterministic,
      ai: { report: { recommendation_copy: {} } },
      mainIssue: "product_content",
    });
    const byId = new Map(recommendations.map((action) => [action.id, action]));

    expect(byId.get("rewrite-seo-title")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
    expect(byId.get("rewrite-meta-description")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
    expect(byId.get("improve-url-handle")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
    expect(byId.get("add-specs-details-block")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
    expect(byId.get("update-product-classification")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
    expect(byId.has("add-structured-metafields")).toBe(false);
    expect(byId.get("add-to-watchlist")?.payload).toMatchObject({ impactLevel: "Medium impact", actionTier: 2 });
  });
});
