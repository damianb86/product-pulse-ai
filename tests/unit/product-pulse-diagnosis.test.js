/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/lib/product-pulse-ai.server.js", () => ({
  runProductDiagnosisAiAnalysis: vi.fn(),
}));
vi.mock("../../app/lib/product-pulse-job-logs.server", () => ({
  recordJobLog: vi.fn(),
  serializeError: (error) => ({ message: error?.message || String(error) }),
}));

const { __productPulseDiagnosisTestHooks } = await import("../../app/lib/product-pulse-diagnosis.server.js");

describe("ProductPulse diagnosis return extraction helpers", () => {
  it("reads Shopify return notes from reason and customer note fields", () => {
    const returnLineItem = {
      returnReason: "OTHER",
      returnReasonNote: "Scares me more than nothing.",
      customerNote: "I want them to take him away.",
      returnReasonDefinition: {
        handle: "OTHER",
        name: "Other",
      },
    };

    expect(__productPulseDiagnosisTestHooks.getReturnReasonValue(returnLineItem)).toBe("OTHER");
    expect(__productPulseDiagnosisTestHooks.getReturnLineItemNoteText(returnLineItem)).toBe("Scares me more than nothing. I want them to take him away.");
  });

  it("matches returned line items by title when Shopify omits the product object", () => {
    const lineItem = {
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      sku: "",
      product: null,
      variant: null,
    };
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
      variants: [],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
    };

    expect(__productPulseDiagnosisTestHooks.lineItemMatchesProduct(lineItem, product, snapshot)).toBe(true);
  });

  it("matches returned line items with strong title overlap when Shopify sends a shortened line title", () => {
    const lineItem = {
      title: "The Night Watch",
      sku: "",
      product: null,
      variant: null,
    };
    const product = {
      id: "gid://shopify/Product/123",
      numericId: "123",
      title: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
      variants: [],
    };
    const snapshot = {
      productGid: "gid://shopify/Product/123",
      productTitle: "THE NIGHT WATCH | REMBRANDT VAN RIJN",
      handle: "the-night-watch-rembrandt-van-rijn",
    };

    expect(__productPulseDiagnosisTestHooks.lineItemMatchesProduct(lineItem, product, snapshot)).toBe(true);
  });

  it("reads GraphQL connections returned as either nodes or edges", () => {
    expect(__productPulseDiagnosisTestHooks.getNodes({ edges: [{ node: { id: "1" } }, { node: null }] })).toEqual([{ id: "1" }]);
    expect(__productPulseDiagnosisTestHooks.getNodes({ nodes: [{ id: "2" }] })).toEqual([{ id: "2" }]);
  });

  it("can request latest returnReasonDefinition while keeping a legacy query path", () => {
    const latestQuery = __productPulseDiagnosisTestHooks.buildDiagnosisReturnsQuery({ includeReasonDefinition: true });
    const legacyQuery = __productPulseDiagnosisTestHooks.buildDiagnosisReturnsQuery({ includeReasonDefinition: false });

    expect(latestQuery).toContain("returnReasonDefinition");
    expect(latestQuery).toContain("returnReasonNote");
    expect(latestQuery).toContain("customerNote");
    expect(latestQuery).toContain("sortKey: UPDATED_AT");
    expect(legacyQuery).not.toContain("returnReasonDefinition");
    expect(legacyQuery).toContain("returnReasonNote");
    expect(legacyQuery).toContain("customerNote");
  });

  it("uses return status queries as a fallback to updated order search", () => {
    const queryModes = __productPulseDiagnosisTestHooks.buildReturnOrderQueries(90).map((query) => query.mode);

    expect(queryModes).toEqual([
      "updated_at",
      "return_requested",
      "in_progress",
      "inspection_complete",
      "returned",
    ]);
  });

  it("classifies fear language without objective danger as a subjective negative reaction", () => {
    expect(__productPulseDiagnosisTestHooks.classifyIssueText("Scares me more than nothing. I want them to take him away.")).toBe("subjective_negative_reaction");
    expect(__productPulseDiagnosisTestHooks.classifyIssueText("This product is unsafe and dangerous for children.")).toBe("safety_concern");
  });

  it("extracts return-note sentiment and subjective evidence from Other returns", () => {
    const insights = __productPulseDiagnosisTestHooks.buildCustomerTextInsights({
      returns: [{
        reason: "OTHER",
        reasonNote: "Scares me more than nothing.",
        customerNote: "I want them to take him away.",
        createdAt: "2026-05-13T12:00:00Z",
      }],
      reviews: [],
    });

    expect(insights.sentiment.total).toBe(1);
    expect(insights.sentiment.negative).toBe(1);
    expect(insights.subjectiveNegativity.count).toBe(1);
    expect(insights.otherReturnClassifications[0].issueCode).toBe("subjective_negative_reaction");
    expect(insights.returns.examples[0].text).toContain("Scares me");
  });

  it("keeps single subjective signals low-confidence while repeated subjective evidence escalates", () => {
    const baseMetrics = {
      soldUnits: 0,
      returnUnits: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnRate: 0,
      refundRate: 0,
      reviewCount: 0,
      avgRating: 0,
      negativeReviewCount: 0,
      negativeReviewRate: 0,
      signalEvents: [],
      affectedVariants: [],
      contentQualityRisk: 0,
      contentIssueCount: 0,
    };
    const oneSubjective = {
      sentiment: { total: 1, negative: 1, negativeRatio: 1 },
      subjectiveNegativity: { count: 1, total: 1, ratio: 1 },
    };
    const repeatedSubjective = {
      sentiment: { total: 5, negative: 5, negativeRatio: 1 },
      subjectiveNegativity: { count: 5, total: 5, ratio: 1 },
    };

    const oneRisk = __productPulseDiagnosisTestHooks.calculateRiskScore({
      snapshot: { metrics: {} },
      metrics: { ...baseMetrics, signalCount: 1, customerSignalCount: 1, textInsights: oneSubjective, sourceCoverage: ["Shopify returns"] },
    });
    const repeatedRisk = __productPulseDiagnosisTestHooks.calculateRiskScore({
      snapshot: { metrics: {} },
      metrics: { ...baseMetrics, signalCount: 5, customerSignalCount: 5, textInsights: repeatedSubjective, sourceCoverage: ["Shopify returns"] },
    });
    const oneConfidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 1,
      sourceCoverage: ["Shopify returns"],
      judgeMeMatchConfidence: 0,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 1,
      mainIssue: "subjective_negative_reaction",
      textInsights: oneSubjective,
    });
    const repeatedConfidence = __productPulseDiagnosisTestHooks.calculateConfidence({
      signalCount: 5,
      sourceCoverage: ["Shopify returns"],
      judgeMeMatchConfidence: 0,
      orderAccessDenied: false,
      sourceAgreement: false,
      recentSignals: 5,
      mainIssue: "subjective_negative_reaction",
      textInsights: repeatedSubjective,
    });

    expect(oneRisk).toBeLessThan(repeatedRisk);
    expect(oneConfidence).toBeLessThanOrEqual(45);
    expect(repeatedConfidence).toBeGreaterThan(oneConfidence);
  });
});
