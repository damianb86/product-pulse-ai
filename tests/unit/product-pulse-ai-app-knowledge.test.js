/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));

const {
  AppKnowledgeRepository,
} = await import("../../app/ai/appKnowledge/repository.server");
const {
  PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES,
  createAppKnowledgeToolDefinitions,
} = await import("../../app/ai/appKnowledge/tools.server");
const {
  createAiToolRegistry,
} = await import("../../app/ai/tools/registry.server");
const {
  mapAiPresentationBlockToChatKitWidget,
} = await import("../../app/ai/chatkit/widgets");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  createdAt: "2026-05-21T12:00:00.000Z",
};

describe("ProductPulse AI app knowledge repository", () => {
  it("searches curated app knowledge without exposing implementation refs to merchants", () => {
    const repository = new AppKnowledgeRepository();

    const result = repository.search({
      query: "how does quick analysis select candidates",
      limit: 3,
      audience: "merchant",
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toMatch(/QuickScan|candidates/i);
    expect(JSON.stringify(result)).toContain("QuickScan");
    expect(JSON.stringify(result)).not.toContain("app/lib/");
    expect(result.results[0].source).not.toHaveProperty("implementationRefs");
  });

  it("can include developer implementation references only when requested", () => {
    const repository = new AppKnowledgeRepository();

    const result = repository.search({
      query: "risk formula",
      topic: "scoring",
      audience: "developer",
      limit: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source.implementationRefs?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.results[0].source)).toContain("app/lib/");
  });

  it("returns real score explanations and refuses to invent unknown formulas", () => {
    const repository = new AppKnowledgeRepository();

    const risk = repository.getScoreExplanation("risk score");
    const revenueAtRisk = repository.getScoreExplanation("Revenue at risk");
    const marginAtRisk = repository.getScoreExplanation("margin at risk");
    const refundRate = repository.getScoreExplanation("refund rate");
    const candidateScore = repository.getScoreExplanation("QuickScan candidate score");
    const unknown = repository.getScoreExplanation("magic conversion score");

    expect(risk.found).toBe(true);
    expect(risk.formula).toContain("riskScore");
    expect(risk.thresholds.map((threshold) => threshold.value)).toContain(">= 75");
    expect(revenueAtRisk.found).toBe(true);
    expect(revenueAtRisk.formula).toContain("projectedLostRevenue");
    expect(revenueAtRisk.caveats.join(" ")).toContain("stored revenueAtRisk");
    expect(marginAtRisk.found).toBe(true);
    expect(marginAtRisk.formula).toContain("projectedLostMargin");
    expect(refundRate.found).toBe(true);
    expect(refundRate.formula).toContain("refundUnits / soldUnits");
    expect(candidateScore.found).toBe(true);
    expect(candidateScore.formula).toContain("max(riskScore, productMomentum.score)");
    expect(JSON.stringify(risk)).not.toContain("app/lib/");
    expect(unknown.found).toBe(false);
    expect(unknown.logic).toContain("Unknown");
    expect(unknown.caveats.join(" ")).toContain("should not invent");
  });

  it("returns settings and screen guides grounded in documented behavior", () => {
    const repository = new AppKnowledgeRepository();

    const lookback = repository.getSettingExplanation("analysis.lookbackDays");
    const dashboard = repository.getScreenGuide("Dashboard");

    expect(lookback.found).toBe(true);
    expect(lookback.defaultValue).toBe("60");
    expect(lookback.allowedValues).toContain("10 to 365 days");
    expect(dashboard.found).toBe(true);
    expect(dashboard.howToRead.join(" ")).toContain("active jobs");
    expect(dashboard.commonActions).toContain("Run scan");
  });
});

describe("ProductPulse AI app knowledge tools", () => {
  it("registers app knowledge tools as read-only provider-agnostic tools", () => {
    const definitions = createAppKnowledgeToolDefinitions();

    expect(definitions.map((definition) => definition.name)).toEqual([
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchAppKnowledge,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getAppConceptExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScoreExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScreenGuide,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getSettingExplanation,
    ]);
    expect(definitions.every((definition) => definition.readOnly)).toBe(true);
    expect(definitions.every((definition) => definition.category === "app_knowledge")).toBe(true);
    expect(definitions.every((definition) => definition.metadata?.providerAgnostic)).toBe(true);
  });

  it("executes through the shared registry and rejects tenant override attempts", async () => {
    const registry = createAiToolRegistry();

    const result = await registry.executeAiTool(
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScoreExplanation,
      context,
      { scoreName: "Product Momentum" },
    );
    const rejected = await registry.executeAiTool(
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchAppKnowledge,
      context,
      { query: "settings", shop: "evil.myshopify.com" },
    );

    expect(result.ok).toBe(true);
    expect(result.data.scoreName).toBe("Product Momentum");
    expect(result.data.formula).toContain("currentVelocity");
    expect(rejected.ok).toBe(false);
    expect(rejected.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps app knowledge presentation blocks to ChatKit widgets", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "score_explanation",
      scoreName: "Risk score",
      meaning: "A deterministic 0-100 heuristic score for product risk.",
      logic: "Risk sums capped component families.",
      formula: "riskScore = round(clamp(..., 0, 100))",
      range: "0 to 100",
      inputs: ["Returns", "Reviews"],
      thresholds: [{ label: "High risk", value: ">= 75", meaning: "Needs attention." }],
      interpretation: ["Higher means stronger product friction."],
      caveats: ["Risk is not a probability."],
    });

    expect(widget.type).toBe("Card");
    expect(JSON.stringify(widget)).toContain("Risk score");
    expect(JSON.stringify(widget)).not.toContain("<script");
  });
});
