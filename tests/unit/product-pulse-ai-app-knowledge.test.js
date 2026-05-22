/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));

const {
  AppKnowledgeRepository,
} = await import("../../app/ai/appKnowledge/repository.server");
const {
  AppInteractionGuidanceRepository,
} = await import("../../app/ai/appKnowledge/interactionGuidance.server");
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
    const velocity = repository.getScoreExplanation("Velocity");
    const growth = repository.getScoreExplanation("Growth");
    const catalogShare = repository.getScoreExplanation("Catalog share");
    const trendConsistency = repository.getScoreExplanation("Trend consistency");
    const recency = repository.getScoreExplanation("Recency");
    const lift = repository.getScoreExplanation("lift");
    const returnPressure = repository.getScoreExplanation("Return Pressure");
    const refundLeakage = repository.getScoreExplanation("Refund leakage");
    const negativeReviewPressure = repository.getScoreExplanation("Negative review pressure");
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
    expect(velocity.found).toBe(true);
    expect(velocity.formula).toContain("currentVelocity");
    expect(growth.found).toBe(true);
    expect(growth.formula).toContain("combinedGrowthRatio");
    expect(catalogShare.found).toBe(true);
    expect(catalogShare.formula).toContain("catalogShareScore");
    expect(trendConsistency.found).toBe(true);
    expect(trendConsistency.formula).toContain("trendConsistencyScore");
    expect(recency.found).toBe(true);
    expect(recency.formula).toContain("riskRecencyBonus");
    expect(lift.found).toBe(true);
    expect(lift.formula).toContain("relationshipLift");
    expect(returnPressure.found).toBe(true);
    expect(returnPressure.formula).toContain("returnRiskWeight");
    expect(refundLeakage.found).toBe(true);
    expect(refundLeakage.formula).toContain("refundRiskWeight");
    expect(negativeReviewPressure.found).toBe(true);
    expect(negativeReviewPressure.formula).toContain("negativeReviewCount / reviewCount");
    expect(JSON.stringify(risk)).not.toContain("app/lib/");
    expect(unknown.found).toBe(false);
    expect(unknown.logic).toContain("Unknown");
    expect(unknown.caveats.join(" ")).toContain("should not invent");
  });

  it("returns product detail card explanations for visible product page cards and metrics", () => {
    const repository = new AppKnowledgeRepository();

    const overview = repository.getProductDetailCardExplanation("Overview");
    const recommendedActions = repository.getProductDetailCardExplanation("Recommended Actions");
    const basketContext = repository.getProductDetailCardExplanation("Basket Context");
    const relationshipTimeline = repository.getProductDetailCardExplanation("Product relationship timeline");
    const lift = repository.getProductDetailCardExplanation("Lift");
    const returnPressure = repository.getProductDetailCardExplanation("Return pressure");
    const search = repository.searchProductDetailCards({ query: "return refund relationship lift", limit: 4 });
    const unknown = repository.getProductDetailCardExplanation("magic card");

    expect(overview.found).toBe(true);
    expect(overview.valueFormula).toContain("ProductRiskSnapshot");
    expect(recommendedActions.found).toBe(true);
    expect(recommendedActions.caveats.join(" ")).toContain("Shopify");
    expect(basketContext.found).toBe(true);
    expect(basketContext.valueFormula).toContain("multiProductBasketRate");
    expect(relationshipTimeline.found).toBe(true);
    expect(relationshipTimeline.valueFormula).toContain("sameOrderLift");
    expect(lift.found).toBe(true);
    expect(lift.supportingFormulas.join(" ")).toContain("shareLiftRatio");
    expect(returnPressure.found).toBe(true);
    expect(returnPressure.supportingFormulas.join(" ")).toContain("returnRiskWeight");
    expect(search.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(search)).not.toContain("app/lib/");
    expect(unknown.found).toBe(false);
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

  it("returns guided next-step options for ambiguous product action requests", () => {
    const repository = new AppInteractionGuidanceRepository();

    const guidance = repository.getGuidance({
      query: "quiero agregar una nueva accion a este producto",
      hasProductContext: true,
      limit: 4,
    });

    expect(guidance.intent).toBe("create_product_action");
    expect(guidance.clarificationQuestion).toContain("Qué tipo de acción");
    expect(guidance.options.map((option) => option.id)).toContain("description_guidance");
    expect(guidance.options.map((option) => option.id)).toContain("seo_recommendation");
    expect(guidance.options.every((option) => option.requiresConfirmation)).toBe(true);
    expect(JSON.stringify(guidance)).toContain("product_pulse_create_product_action");
    expect(JSON.stringify(guidance)).not.toContain("app/lib/");
  });
});

describe("ProductPulse AI app knowledge tools", () => {
  it("registers app knowledge tools as read-only provider-agnostic tools", () => {
    const definitions = createAppKnowledgeToolDefinitions();

    expect(definitions.map((definition) => definition.name)).toEqual([
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchAppKnowledge,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getAppConceptExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScoreExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchProductDetailCards,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getProductDetailCardExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScreenGuide,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getSettingExplanation,
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getInteractionGuidance,
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
    const guidance = await registry.executeAiTool(
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getInteractionGuidance,
      context,
      {
        query: "quiero informacion de este producto",
        hasProductContext: true,
        limit: 3,
      },
    );
    const card = await registry.executeAiTool(
      PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getProductDetailCardExplanation,
      context,
      { cardName: "Basket Context" },
    );

    expect(result.ok).toBe(true);
    expect(result.data.scoreName).toBe("Product Momentum");
    expect(result.data.formula).toContain("currentVelocity");
    expect(guidance.ok).toBe(true);
    expect(guidance.data.intent).toBe("product_information");
    expect(guidance.data.options).toHaveLength(3);
    expect(card.ok).toBe(true);
    expect(card.data.valueFormula).toContain("multiProductBasketRate");
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

  it("maps interaction guidance blocks to ChatKit option cards", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "interaction_guidance",
      title: "Crear una acción para el producto",
      summary: "Necesito saber qué tipo de acción querés crear.",
      clarificationQuestion: "Qué tipo de acción querés agregar a este producto?",
      options: [
        {
          id: "description_guidance",
          label: "Nota o guía de descripción",
          description: "Crea una acción de ProductPulse con texto sugerido.",
          examplePrompt: "Creá una acción para agregar una nota de expectativas.",
          category: "app_mutation",
          requiresProductContext: true,
          requiresConfirmation: true,
        },
      ],
      caveats: ["No modifica Shopify."],
    });

    expect(widget.type).toBe("Card");
    expect(JSON.stringify(widget)).toContain("Nota o guía de descripción");
    expect(JSON.stringify(widget)).toContain("Ejemplo:");
    expect(JSON.stringify(widget)).toContain("Confirm first");
    expect(JSON.stringify(widget)).not.toContain("backendCapability");
  });
});
