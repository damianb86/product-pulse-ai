import prisma from "../db.server";
import { createAiUsageTracker, normalizeAiUsageCall } from "./product-pulse-ai-usage.server";
import { recordAiUsageEvent } from "../ai/observability/usageEvents.server";
import { isProductPulseDevelopment } from "./product-pulse-dev.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const GEMINI_PROVIDER = "gemini";
const OPENAI_PROVIDER = "openai";
const PRODUCT_PULSE_AI_LEVEL_ENV = "PRODUCT_PULSE_AI_LEVEL";
const PRODUCT_PULSE_AI_LEVELS = {
  DEVELOPMENT_GEMINI: 1,
  DEVELOPMENT_OPENAI_BASIC: 2,
  PRODUCTION_TIERED_OPENAI: 3,
};
const GEMINI_PRIMARY_RETRY_MS = 24 * 60 * 60 * 1000;
const GEMINI_MODEL_RETRY_DELAY_MS = 750;

const AI_TASKS = {
  signal_classification: {
    modelEnv: ["OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-mini",
    maxOutputTokens: 3200,
    temperature: 0.1,
  },
  emergent_sentiment: {
    modelEnv: ["OPENAI_BASIC_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 2200,
    temperature: 0.15,
  },
  content_gap: {
    modelEnv: ["OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-mini",
    maxOutputTokens: 1600,
    temperature: 0.1,
  },
  content_coverage_validation: {
    modelEnv: ["OPENAI_BASIC_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 1800,
    temperature: 0,
  },
  action_rationale: {
    modelEnv: ["OPENAI_BASIC_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 1800,
    temperature: 0.2,
  },
  relationship_insights: {
    modelEnv: ["AI_RELATIONSHIP_INSIGHTS_MODEL", "OPENAI_BASIC_MODEL", "AI_CHAT_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 1100,
    temperature: 0.15,
  },
  chart_interpretations: {
    modelEnv: ["OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-mini",
    maxOutputTokens: 1500,
    temperature: 0.15,
  },
  final_report: {
    modelEnv: ["OPENAI_PREMIUM_MODEL", "OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL"],
    fallbackModel: "gpt-5.4",
    maxOutputTokens: 3600,
    temperature: 0.2,
  },
  watch_change_report: {
    modelEnv: ["OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-mini",
    maxOutputTokens: 1100,
    temperature: 0.2,
  },
  test_text: {
    modelEnv: ["OPENAI_BASIC_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 520,
    temperature: 0.35,
  },
};

const PREDEFINED_CUSTOMER_SENTIMENTS = [
  { code: "frustration", polarity: "negative", description: "The customer sounds blocked, annoyed, or tired of the product problem." },
  { code: "disappointment", polarity: "negative", description: "The product failed an expectation the customer had before purchase." },
  { code: "anger", polarity: "negative", description: "The customer is strongly upset or confrontational." },
  { code: "fear", polarity: "negative", description: "The product language evokes fear, safety concern, or a scary reaction." },
  { code: "confusion", polarity: "negative", description: "The customer is unsure how the product works, fits, or should be used." },
  { code: "distrust", polarity: "negative", description: "The customer questions the product, description, brand, or stated value." },
  { code: "regret", polarity: "negative", description: "The customer signals buyer remorse or wishes they had not purchased." },
  { code: "uncertainty", polarity: "neutral", description: "The customer is not clearly negative or positive but lacks confidence." },
  { code: "indifference", polarity: "neutral", description: "The customer has a flat or low-intensity reaction." },
  { code: "satisfaction", polarity: "positive", description: "The customer indicates the product met expectations." },
  { code: "trust", polarity: "positive", description: "The customer expresses confidence in the product or brand." },
  { code: "relief", polarity: "positive", description: "The customer says the product solved a concern or avoided friction." },
  { code: "delight", polarity: "positive", description: "The customer expresses excitement or strong positive surprise." },
];

export async function runProductDiagnosisAiAnalysis({ shop, jobId, input }) {
  const usageTracker = createAiUsageTracker({
    shop,
    jobId,
    operation: "product_diagnosis",
    metadata: {
      productGid: input?.product?.id || input?.product?.productGid || null,
      productHandle: input?.product?.handle || null,
    },
  });

  try {
  const classificationPrompt = buildSignalClassificationPrompt(input);
  const classificationResponse = await generateAiText({
    shop,
    jobId,
    task: "signal_classification",
    prompt: classificationPrompt,
    usageTracker,
  });
  const classification = parseAiJson(classificationResponse.text, {
    classified_signals: [],
    clusters: [],
    granular_findings: [],
    repeated_language: [],
    sentiment_summary: {},
    action_guidance: {},
    main_issue: input?.deterministic?.mainIssue || "product_quality",
    issue_summary: "AI classification was unavailable; deterministic issue signals were used.",
    source_agreement: "unknown",
  });

  const emergentSentimentResponse = await generateAiText({
    shop,
    jobId,
    task: "emergent_sentiment",
    prompt: buildEmergentSentimentPrompt(input, classification),
    usageTracker,
  });
  const emergentSentiments = parseAiJson(emergentSentimentResponse.text, {
    emergent_sentiments: [],
    discarded_suggestions: [],
    summary: "No emergent customer sentiments were detected.",
  });

  const cachedContentGaps = input?.incremental?.productContent?.cachedContentGaps || null;
  let gapResponse = null;
  let contentGaps = null;
  if (cachedContentGaps) {
    contentGaps = cachedContentGaps;
    gapResponse = {
      provider: "cache",
      model: "previous-product-content-analysis",
      task: "content_gap",
      text: JSON.stringify(cachedContentGaps),
      usage: usageTracker.record({
        provider: "cache",
        model: "previous-product-content-analysis",
        task: "content_gap",
        requestContext: "cache",
        usageSource: "cache",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      }),
    };
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.content_gap_reused",
      message: "Reused previous product content-gap analysis because Shopify product content has not changed since the last product diagnosis.",
      data: {
        provider: "cache",
        task: "content_gap",
        previousCompletedAt: input?.incremental?.previousCompletedAt || null,
        productUpdatedAt: input?.incremental?.productContent?.productUpdatedAt || null,
      },
    });
  } else {
    const gapPrompt = buildContentGapPrompt(input, classification);
    gapResponse = await generateAiText({
      shop,
      jobId,
      task: "content_gap",
      prompt: gapPrompt,
      usageTracker,
    });
    contentGaps = parseAiJson(gapResponse.text, {
      missing: [],
      present: [],
      notes: "AI PDP content-gap analysis was unavailable.",
    });
  }

  const reportPrompt = buildFinalReportPrompt(input, classification, contentGaps, emergentSentiments);
  const reportResponse = await generateAiText({
    shop,
    jobId,
    task: "final_report",
    prompt: reportPrompt,
    usageTracker,
  });
  const report = parseAiJson(reportResponse.text, {
    main_finding_title: input?.deterministic?.mainIssueLabel || "Product issue needs review",
    main_finding_detail: input?.deterministic?.evidenceSummary || "ProductPulse found deterministic signals that should be reviewed.",
    evidence_summary: input?.deterministic?.evidenceSummary || "",
    basket_context_interpretation: "",
    evidence_synthesis_sections: [],
    recommendation_copy: {},
  });

  let contentCoverageValidationResponse = null;
  let contentCoverageValidation = { coverage: [], summary: "No product-content coverage validation was run." };
  const contentCoveragePrompt = buildContentCoverageValidationPrompt(input, report, contentGaps);
  if (contentCoveragePrompt) {
    try {
      contentCoverageValidationResponse = await generateAiText({
        shop,
        jobId,
        task: "content_coverage_validation",
        prompt: contentCoveragePrompt,
        usageTracker,
      });
      contentCoverageValidation = parseAiJson(contentCoverageValidationResponse.text, {
        coverage: [],
        summary: "Product-content coverage validation was unavailable.",
      });
    } catch (error) {
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.content_coverage_validation_failed",
        message: "AI product-content coverage validation failed; deterministic duplicate checks will be used.",
        data: { error: serializeError(error) },
      }).catch(() => {});
    }
  }

  const actionRationaleResponse = await generateAiText({
    shop,
    jobId,
    task: "action_rationale",
    prompt: buildActionRationalePrompt(input, classification, contentGaps, emergentSentiments, report),
    usageTracker,
  });
  const actionRationales = parseAiJson(actionRationaleResponse.text, {
    action_rationales: [],
  });
  const compactChartInput = buildCompactProductChartInterpretationInput(input);
  let chartInterpretationsResponse = null;
  let chartInterpretations = normalizeProductChartInterpretations(null, compactChartInput);
  if (compactChartInput.available) {
    try {
      chartInterpretationsResponse = await generateAiText({
        shop,
        jobId,
        task: "chart_interpretations",
        prompt: buildProductChartInterpretationsPrompt(compactChartInput),
        usageTracker,
      });
      chartInterpretations = normalizeProductChartInterpretations(
        parseAiJson(chartInterpretationsResponse.text, { chart_interpretations: {} }),
        compactChartInput,
        pickAiModelSummary(chartInterpretationsResponse),
      );
    } catch (error) {
      chartInterpretations = normalizeProductChartInterpretations({
        status: "ai_unavailable",
        chart_interpretations: {},
      }, compactChartInput);
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.chart_interpretations_failed",
        message: "AI chart interpretations were skipped after the intermediate chart interpretation model failed.",
        data: { error: serializeError(error) },
      }).catch(() => {});
    }
  }
  const compactRelationshipInput = buildCompactProductRelationshipAiInput(input);
  let relationshipInsightsResponse = null;
  let relationshipInsights = normalizeProductRelationshipAiInsights(null, compactRelationshipInput);
  if (compactRelationshipInput.available) {
    try {
      relationshipInsightsResponse = await generateAiText({
        shop,
        jobId,
        task: "relationship_insights",
        prompt: buildProductRelationshipInsightsPrompt(compactRelationshipInput),
        usageTracker,
      });
      relationshipInsights = normalizeProductRelationshipAiInsights(
        parseAiJson(relationshipInsightsResponse.text, { insights: [] }),
        compactRelationshipInput,
        pickAiModelSummary(relationshipInsightsResponse),
      );
    } catch (error) {
      relationshipInsights = normalizeProductRelationshipAiInsights({
        status: "ai_unavailable",
        insights: [],
      }, compactRelationshipInput);
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.relationship_insights_failed",
        message: "Product relationship AI insights were skipped after the relationship insight model failed.",
        data: { error: serializeError(error) },
      }).catch(() => {});
    }
  }
  const aiUsage = await usageTracker.logSummary({
    event: "product_diagnosis.ai_token_usage",
    data: {
      productGid: input?.product?.id || input?.product?.productGid || null,
      productHandle: input?.product?.handle || null,
    },
  });

  return {
    provider: reportResponse.provider,
    model: reportResponse.model,
    aiUsage,
    modelsUsed: {
      classification: pickAiModelSummary(classificationResponse),
      emergentSentiment: pickAiModelSummary(emergentSentimentResponse),
      contentGap: pickAiModelSummary(gapResponse),
      contentCoverageValidation: contentCoverageValidationResponse ? pickAiModelSummary(contentCoverageValidationResponse) : null,
      actionRationale: pickAiModelSummary(actionRationaleResponse),
      chartInterpretations: chartInterpretationsResponse ? pickAiModelSummary(chartInterpretationsResponse) : null,
      relationshipInsights: relationshipInsightsResponse ? pickAiModelSummary(relationshipInsightsResponse) : null,
      finalReport: pickAiModelSummary(reportResponse),
    },
    classification,
    emergentSentiments,
    contentGaps,
    contentCoverageValidation,
    actionRationales,
    chartInterpretations,
    relationshipInsights,
    report,
    raw: {
      classification: classificationResponse.text,
      emergentSentiments: emergentSentimentResponse.text,
      contentGaps: gapResponse.text,
      contentCoverageValidation: contentCoverageValidationResponse?.text || "",
      actionRationales: actionRationaleResponse.text,
      chartInterpretations: chartInterpretationsResponse?.text || "",
      relationshipInsights: relationshipInsightsResponse?.text || "",
      report: reportResponse.text,
    },
  };
  } catch (error) {
    await usageTracker.logSummary({
      level: "warn",
      event: "product_diagnosis.ai_token_usage_partial",
      message: "AI token usage captured before the product diagnosis AI step failed.",
      data: {
        productGid: input?.product?.id || input?.product?.productGid || null,
        productHandle: input?.product?.handle || null,
        error: serializeError(error),
      },
    }).catch(() => {});
    throw error;
  }
}

export async function generateProductDiagnosisTestText({ shop, jobId, product }) {
  const prompt = buildProductDiagnosisPrompt(product);
  return generateAiText({ shop, jobId, task: "test_text", prompt });
}

export async function generateWatchChangeReportNarrative({ shop, jobId, productTitle, report }) {
  const prompt = buildWatchChangeReportNarrativePrompt({ productTitle, report });
  const response = await generateAiText({ shop, jobId, task: "watch_change_report", prompt });
  return cleanAiParagraph(response.text);
}

function buildWatchChangeReportNarrativePrompt({ productTitle, report }) {
  const payload = buildWatchChangeReportNarrativePayload({ productTitle, report });
  return [
    "You are writing a Watchlist change report for a Shopify merchant.",
    "Write primarily about concreteSourceChanges. These are the only events that happened since the previous Watchlist run.",
    "Never describe historical aggregate totals or healthContext values as new activity.",
    "Only say there were new returns, refunds, reviews, rating movement, reason text, sentiment, repeated language, or product-content changes when that source appears in concreteSourceChanges.",
    "If a source appears in notNewSourceTypes, do not use phrases like new return activity, new refund activity, new reviews, latest review, or new product content for that source.",
    "Treat secondaryCalculatedContext as secondary context only. It can explain how the product looks healthier or riskier now, but it is not new source activity.",
    "Start with the concrete changes. If only orders changed, the first sentence must only describe the new order activity.",
    "Do not invent facts. Do not say the report is generated by AI. Do not add recommendations unless they are directly implied by new concrete source activity.",
    "Return one concise but detailed paragraph in English, 70-130 words. No markdown, no bullets, no JSON.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function buildWatchChangeReportNarrativePayload({ productTitle, report }) {
  const concreteSourceChanges = (report?.sourceChanges || []).map(sanitizeWatchSourceChangeForNarrative);
  const concreteSourceTypes = Array.from(new Set(concreteSourceChanges.map((change) => change.source).filter(Boolean)));
  const sourceTypes = ["orders", "returns", "refunds", "reviews", "content"];
  const notNewSourceTypes = sourceTypes.filter((source) => !concreteSourceTypes.includes(source));
  const secondaryCalculatedContext = (report?.changes || []).slice(0, 10).map((change) => ({
    label: change.label,
    from: change.from,
    to: change.to,
    delta: change.delta,
    detail: change.detail,
  }));
  const secondaryInsights = (report?.sourceInsights || [])
    .filter((insight) => !concreteSourceTypes.some((source) => String(insight.id || "").includes(source.replace(/s$/, ""))))
    .slice(0, 4)
    .map((insight) => ({
      title: insight.title,
      metric: insight.metric,
      summary: insight.summary,
    }));

  return {
    productTitle,
    status: report?.status,
    headline: report?.headline,
    summary: report?.summary,
    previousRunAt: report?.previousRunAt || report?.previous?.capturedAt || null,
    currentRunAt: report?.currentRunAt || report?.current?.capturedAt || null,
    concreteSourceChanges,
    concreteSourceTypes,
    notNewSourceTypes,
    secondaryCalculatedContext,
    secondaryInsights,
    healthContext: buildWatchNarrativeHealthContext(report),
    interpretationRules: {
      concreteSourceChangesAreNew: true,
      secondaryCalculatedContextIsNotNewActivity: true,
      notNewSourceTypesMustNotBeCalledNew: true,
    },
  };
}

function sanitizeWatchSourceChangeForNarrative(change = {}) {
  return {
    id: change.id || "",
    source: change.source || "",
    label: change.label || "",
    value: change.value || "",
    delta: change.delta || "",
    detail: change.detail || "",
    items: (Array.isArray(change.items) ? change.items : []).slice(0, 3).map((item) => ({
      createdAt: item.createdAt || "",
      variant: item.variant || item.variantTitle || "",
      sku: item.sku || "",
      quantity: item.quantity || null,
      amount: item.amount || null,
      rating: item.rating || null,
      sentiment: item.sentiment || "",
      text: item.text || item.noteText || item.reasonText || "",
    })),
  };
}

function buildWatchNarrativeHealthContext(report = {}) {
  const pick = (summary = {}) => ({
    riskScore: summary?.riskScore ?? null,
    riskLabel: summary?.riskLabel || "",
    returnRatePercent: summary?.returnRatePercent ?? null,
    refundRatePercent: summary?.refundRatePercent ?? null,
    returnUnits: summary?.returnUnits ?? null,
    refundUnits: summary?.refundUnits ?? null,
    reviewCount: summary?.reviewCount ?? null,
    negativeReviewCount: summary?.negativeReviewCount ?? null,
    revenueAtRisk: summary?.revenueAtRisk ?? null,
    marginAtRisk: summary?.marginAtRisk ?? null,
    productMomentumScore: summary?.productMomentumScore ?? null,
    productMomentumTier: summary?.productMomentumTier || "",
  });
  return {
    previous: pick(report?.previous),
    current: pick(report?.current),
  };
}

function cleanAiParagraph(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function buildSignalClassificationPrompt(input) {
  const snippets = JSON.stringify(input?.evidenceSnippets || [], null, 2);
  const metrics = JSON.stringify(input?.deterministic || {}, null, 2);
  const product = JSON.stringify(input?.product || {}, null, 2);
  const incremental = JSON.stringify(input?.incremental || null, null, 2);
  const previousPrimaryIssue = String(input?.previousPrimaryIssue || "").trim();
  const sentimentTaxonomy = JSON.stringify(PREDEFINED_CUSTOMER_SENTIMENTS, null, 2);

  return [
    "You are ProductPulse AI. Classify customer evidence for one ecommerce product.",
    "Use the text evidence only to interpret language. Do not calculate financial metrics, rates, counts, confidence, or risk score.",
    "If a Shopify return reason is Other, Unknown, or generic, read the customer note/reason text and classify the actual product issue when the text supports it.",
    "Analyze sentiment in return notes and reviews. Capture repeated words, repeated phrases, recurring emotions, and fine-grained findings that should become merchant-facing issues.",
    "Treat csv_review evidence as imported review evidence from a connected CSV source. Treat yotpo_review evidence as Yotpo Reviews evidence. Treat loox_review evidence as Loox Reviews evidence. Use rating, text and date the same way you use Judge.me review evidence, but keep each source label distinct when explaining evidence.",
    "Shopify refund notes are usually written by the merchant or support team, not the customer. Use shopify_refund_note evidence as operational context: classify product issue patterns and repeated refund reasons, but do not treat staff wording as customer sentiment.",
    "Reserve safety_concern for physical danger, injury, hazard, toxicity, choking, fire, or clearly unsafe use. If the customer says the product is scary, creepy, unsettling, ugly, not their style, or they simply dislike it without objective danger, use subjective_negative_reaction.",
    "Subjective negative reactions start low severity and low confidence. Escalate them only when they repeat across independent texts or represent a meaningful share of available customer text.",
    "Separate subjective expectation mismatch from operational quality. If shoppers say the product is too soft, too firm, too dark, too scary, not their style, or a preference mismatch, treat that as expectation/content guidance unless evidence shows damage, malfunction, safety, manufacturing failure, durability failure, or supplier/QA defect.",
    "Understand negation and contrast. Phrases like \"not necessarily a defect\", \"not damaged\", \"not broken\", or \"personal preference\" must not be counted as operational defect evidence by themselves.",
    "Use action_guidance to summarize what action families are appropriate. Prefer shopper-facing description/FAQ/spec/media actions for subjective expectation mismatches. Reserve qa_review, inventory_hold, and status_change for objective defects, safety, durability, malfunction, damage, or high refund pressure.",
    "A single customer text is evidence, not a confirmed merchant-facing issue. Do not create clusters or granular_findings from one isolated word, phrase, return note, or review unless another independent text or another source supports the same issue.",
    "Consolidate overlapping findings. If one text mentions the same concept once, do not output it as a cluster, a granular finding, and repeated_language. signals must count independent customer texts, not repeated words inside the same text.",
    "For repeated_language, never output stop words, helper verbs, connector words, or generic ecommerce/API context such as and, be, been, took, take, item, product, reason, return, review, refund, order, other, selected, customer note, or other reason. Only output shopper-meaningful product terms or phrases.",
    "Use the predefined sentiment taxonomy first. If a customer reaction clearly does not fit the taxonomy, keep sentiment as negative/neutral/positive and add suggested_emotion as a concise snake_case candidate.",
    "Use neutral sentiment when the evidence is factual, mixed, low-intensity, uncertain, or a 3-star review without a clear product complaint or clear praise. Do not force every customer text into positive or negative.",
    "If previousPrimaryIssue is provided and the new top issue is essentially the same diagnosis or failure mode, set main_issue_label exactly to previousPrimaryIssue. Only reword or change main_issue_label when the actual top issue changed, not when you are merely naming the same issue differently.",
    "Return valid JSON only. No markdown.",
    "Predefined sentiment taxonomy:",
    sentimentTaxonomy,
    "Schema:",
    JSON.stringify({
      classified_signals: [{
        source: "judgeme_review|yotpo_review|loox_review|csv_review|shopify_return_note|shopify_return_reason|shopify_refund_note",
        text: "short evidence snippet",
        issue_category: "fit_sizing|quality_defect|durability|color_expectation|compatibility|shipping_delivery|safety_concern|subjective_negative_reaction|support_conversation|other",
        issue_detail: "snake_case_detail",
        affected_area: "optional",
        sentiment: "negative|neutral|positive",
        known_emotion: "frustration|disappointment|anger|fear|confusion|distrust|regret|uncertainty|indifference|satisfaction|trust|relief|delight|none",
        suggested_emotion: "empty_or_new_snake_case_emotion_not_in_taxonomy",
        suggested_emotion_reason: "why this does not fit the predefined taxonomy",
        severity: "low|medium|high",
        product_related: true,
        recommended_action_type: "fit_note|faq|description_update|tag|support_note|variant_review|image_or_size_chart|none",
      }],
      clusters: [{
        issue_category: "fit_sizing",
        issue_detail: "runs_small",
        human_name: "Runs small",
        summary: "short explanation",
        signals: 0,
        source_types: ["judgeme_reviews", "yotpo_reviews", "loox_reviews", "csv_reviews", "returns"],
        severity: "low|medium|high",
      }],
      granular_findings: [{
        finding: "Other return notes repeatedly mention sizing problems",
        issue_category: "fit_sizing",
        issue_detail: "other_returns_run_small",
        sentiment: "negative|neutral|positive",
        severity: "low|medium|high",
        signals: 0,
        source_types: ["shopify_return_note", "shopify_refund_note"],
        evidence: ["short grounded evidence phrase"],
        suggested_action: "Review Other return notes",
        known_emotion: "fear",
        suggested_emotion: "",
      }],
      repeated_language: [{
        term: "too small",
        count: 0,
        source_types: ["judgeme_reviews", "yotpo_reviews", "loox_reviews", "csv_reviews", "shopify_return_note", "shopify_refund_note"],
        sentiment: "negative|neutral|positive",
        known_emotion: "frustration",
        suggested_emotion: "",
        issue_category: "fit_sizing",
        explanation: "Customers repeat this phrase when explaining returns.",
      }],
      sentiment_summary: {
        dominant_sentiment: "negative|neutral|positive|mixed",
        negative_count: 0,
        neutral_count: 0,
        positive_count: 0,
        returns: "short return-note sentiment summary",
        refunds: "short operational refund-note pattern summary",
        reviews: "short review sentiment summary",
        summary: "one merchant-facing sentence",
      },
      action_guidance: {
        issue_nature: "operational_quality|subjective_expectation|content_gap|relationship_expectation|source_integrity|commercial_opportunity|monitor_only|unclear",
        subjectivity_level: "low|medium|high",
        operational_quality_confidence: "low|medium|high",
        shopper_expectation_confidence: "low|medium|high",
        should_escalate_qa: false,
        qa_reason: "short reason; empty when QA is not supported",
        primary_action_family: "description_update|faq|specs_block|media_context|qa_review|variant_review|source_integrity|workflow_only|monitor",
        recommended_action_families: ["description_update", "faq"],
        blocked_action_families: ["qa_review", "inventory_hold", "status_change"],
        rationale: "one sentence explaining the action interpretation",
      },
      main_issue: "fit_sizing",
      main_issue_label: "Sizing and fit",
      issue_summary: "one concise paragraph",
      source_agreement: "returns_and_reviews_agree|single_source|weak|none",
    }, null, 2),
    "Product:",
    product,
    "Previous stored primary issue:",
    previousPrimaryIssue || "none",
    "Incremental diagnosis context:",
    incremental,
    "If this is an incremental diagnosis, evidence snippets contain only newly changed evidence since the previous product diagnosis. Use deterministic aggregate metrics for full-window totals, and do not invent old snippets that are not supplied.",
    "Deterministic metrics, already calculated by the system:",
    metrics,
    "Evidence snippets:",
    snippets,
  ].join("\n\n");
}

function buildEmergentSentimentPrompt(input, classification) {
  const snippets = JSON.stringify(input?.evidenceSnippets || [], null, 2);
  const classifiedSignals = JSON.stringify(classification?.classified_signals || [], null, 2);
  const granularFindings = JSON.stringify(classification?.granular_findings || [], null, 2);
  const repeatedLanguage = JSON.stringify(classification?.repeated_language || [], null, 2);
  const sentimentTaxonomy = JSON.stringify(PREDEFINED_CUSTOMER_SENTIMENTS, null, 2);

  return [
    "You are ProductPulse AI clustering customer emotions for one ecommerce product.",
    "The system has a finite predefined sentiment taxonomy. Keep using that taxonomy when it fits.",
    "Your job is only to find new or unexpected customer sentiments that are not already represented by the predefined taxonomy.",
    "Review suggested_emotion values, evidence text, repeated language and granular findings. Merge synonyms, near-duplicates, translations and closely related emotional reactions into one normalized sentiment.",
    "Return an emergent sentiment only when there is sufficient evidence: at least 2 independent customer texts, or one very explicit high-severity text plus repeated language that supports it.",
    "Do not create new sentiments for known taxonomy emotions such as fear, frustration, disappointment, anger or confusion. Those remain known_emotion values.",
    "Do not calculate risk score, confidence score, financial impact, rates or counts outside the customer texts supplied here. Treat shopify_refund_note as operational merchant/support text rather than customer emotion.",
    "Return valid JSON only. No markdown.",
    "Predefined sentiment taxonomy:",
    sentimentTaxonomy,
    "Schema:",
    JSON.stringify({
      emergent_sentiments: [{
        label: "Creeped out",
        normalized_label: "creeped_out",
        polarity: "negative|neutral|positive|mixed",
        signals: 0,
        confidence: "low|medium|high",
        has_sufficient_evidence: true,
        merged_from: ["unsettled", "creeped_out"],
        source_types: ["shopify_return_note", "judgeme_review", "yotpo_review", "loox_review", "csv_review", "shopify_refund_note"],
        issue_category: "safety_concern|subjective_negative_reaction|product_quality|other",
        merchant_summary: "Customers describe an unusual emotional reaction that is not covered by the known taxonomy.",
        evidence: ["short grounded quote or phrase"],
        suggested_action: "Review this emotional reaction in product copy and support guidance",
      }],
      discarded_suggestions: [{
        label: "one-off feeling",
        reason: "Only one weak signal or already covered by predefined taxonomy.",
      }],
      summary: "Short explanation of whether any emergent sentiment deserves merchant attention.",
    }, null, 2),
    "Classified signals:",
    classifiedSignals,
    "Granular findings:",
    granularFindings,
    "Repeated language:",
    repeatedLanguage,
    "Original evidence snippets:",
    snippets,
  ].join("\n\n");
}

function buildContentGapPrompt(input, classification) {
  const product = input?.product || {};
  const normalizedDescription = String(product.description || "").replace(/\s+/g, " ").slice(0, 5000);

  return [
    "You are auditing the product content quality for one ecommerce product.",
    "Review the title, description, tags, product type, vendor, collections, options, variants and issue clusters together.",
    "Identify missing content, unclear copy, contradictions, title/description mismatch, tag/collection mismatch, incoherent metadata, missing specifications, and shopper guidance gaps.",
    "A missing or extremely short description is a product-content issue. A title/description mismatch is only an issue when they clearly describe different products or categories.",
    "Score content quality by shopper decision completeness, not just whether the copy is coherent. Short descriptions can be accurate but should not receive a near-perfect score if they omit specs, use cases, limits, included items, sizing, materials, compatibility, care or expectation guidance.",
    "As a calibration guide: descriptions below 35 words are usually thin and should rarely score above 70; descriptions below 50 words should rarely score above 80 unless the product is genuinely simple and all purchase-critical details are present.",
    "Do not treat product type, tags, or collections missing from the description as a primary product problem. Treat them as low-priority copy improvement suggestions unless they create a real contradiction.",
    "Before marking a content gap, compare the gap against the existing plain description and description_html_excerpt. If the product already covers the buyer question, FAQ, usage limit, fit note, compatibility note, material/care guidance, or expectation setting, do not report it as missing.",
    "If existing copy partially covers a gap, report only the missing delta. Do not ask for a new FAQ or full description rewrite when a small addition to the current copy is enough.",
    "A subjective mismatch must be explicitly grounded in the supplied fields.",
    "Return valid JSON only. Do not calculate financial metrics, rates, customer-signal counts, confidence, or risk score.",
    "Schema:",
    JSON.stringify({
      content_quality_score: 82,
      content_summary: "The description is coherent with the title but lacks fit guidance.",
      present: ["material info"],
      missing: ["fit note"],
      notes: "concise explanation",
      content_issues: [{
        code: "missing_description|short_description|title_description_mismatch|description_variant_mismatch|tag_description_mismatch|collection_mismatch|unclear_value_prop|missing_specifications|contradiction|incoherent_copy|missing_customer_guidance",
        label: "Short product description",
        severity: "low|medium|high",
        evidence: "Specific field-level evidence",
        suggested_action: "Correct product description|Add product description guidance|Rewrite product description",
      }],
      issue_specific_gaps: [{
        issue_category: "fit_sizing",
        missing_content: "fit note",
        why_it_matters: "Customers mention tight chest fit.",
      }],
    }, null, 2),
    "Product content:",
    JSON.stringify({
      title: product.title,
      handle: product.handle,
      description: normalizedDescription,
      description_html_excerpt: product.descriptionHtml ? String(product.descriptionHtml).slice(0, 4000) : "",
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags || [],
      collections: product.collections || [],
      options: product.options || [],
      variants: (product.variants || []).slice(0, 50),
      metafields: product.metafields || [],
      media: product.media || [],
    }, null, 2),
    "AI clusters:",
    JSON.stringify(classification?.clusters || [], null, 2),
  ].join("\n\n");
}

function buildFinalReportPrompt(input, classification, contentGaps, emergentSentiments) {
  return [
    "You are ProductPulse AI writing the final product diagnosis report for a merchant.",
    "The system already calculated all numeric metrics. Never change risk score, confidence, impact, rates, counts, or amounts.",
    "Use the metrics, clusters, product-content analysis, PDP gaps, and recommendation candidates to explain what is happening and draft merchant-ready copy.",
    "Product-modifying copy in recommendation_copy is applied to Shopify only after merchant review. Use your strongest product-copy reasoning here: be specific, accurate, and preserve useful existing product information.",
    "For shopper-facing notes, FAQs, description add-ons, SEO copy, titles, media alt text, and product descriptions, write only the inner merchant-ready copy. The ProductPulse application will wrap notes, FAQ blocks, and add-ons in a consistent HTML callout.",
    "Use plain text or simple paragraph/list structure only. Do not include outer CSS, inline styles, scripts, custom wrappers, or theme-specific markup in recommendation_copy.",
    "When drafting product_description, preserve useful existing description content and expand it with missing shopper guidance instead of replacing the product story from scratch.",
    "Only provide a full product_description rewrite when the current description is missing, very short, incoherent, contradictory, or clearly about the wrong product. If the current description is good and only needs a specific clarification, leave product_description empty or provide a short add-on note instead of a full rewrite.",
    "If the issue is a specific contradiction such as description text mentioning a color or variant that is not available, do not rewrite the whole description. Keep product_description empty unless your proposed text actually corrects that contradiction.",
    "Never return product_description as a copy of the current description. If you cannot improve it materially, return an empty string.",
    "Before writing pdp_copy, product_description, specs_details_block, or FAQ content, compare your proposal against Product.description and Product.descriptionHtml. Do not restate content that is already covered, including existing FAQ questions and answers.",
    "If the current product page partially covers the issue, write only the missing sentence, bullet, or FAQ item. The app will apply that delta to the existing product content and highlight only the added text.",
    "For FAQ items, do not generate questions that are already present or already answered by the product description. If an existing FAQ is present, generate only new missing questions and match the existing concise question/answer style.",
    "When recommendation candidates include a FAQ, generate 2 to 4 concrete customer-facing FAQ items. Each FAQ must answer a repeated buyer uncertainty, content gap, compatibility concern, fit/size concern, return/review pattern, or product expectation issue. Do not invent precise specs; if a fact is not known, word the answer as guidance to check the selected variant, size, materials, compatibility, or product detail.",
    "FAQ content must be returned in recommendation_copy.faq_items as objects with question and answer. Every question must be an actual shopper question ending in ?. Do not put answer-only FAQ paragraphs in faq_answer, pdp_copy, or product_description.",
    "When recommendation candidates include add-specs-details-block, generate recommendation_copy.specs_details_block. This must be a useful technical/customer-facing checklist for the product type and the specific issue evidence, not a recap of vendor, product type, option names, or SKUs.",
    "For specs_details_block, infer the kinds of details a shopper would expect from the product title, description, product type, variants, returns, refunds, and customer language. Use concise bullet lines with titles such as voltage, capacity, dimensions, temperature range, timer behavior, water/condensation guidance, compatibility, materials, care, safety limits, included items, or variant-specific notes when relevant.",
    "Do not present unknown exact measurements as facts in specs_details_block. It is acceptable to include merchant placeholders such as [confirm voltage], [confirm capacity], [confirm temperature range], [confirm dimensions], or [confirm compatibility] so the shop owner can fill the real value before applying.",
    "When pdp_copy and product_description both apply, make product_description compatible with that shopper-facing note so merchants can either add the note or apply the fuller rewrite.",
    "If emergent customer sentiments are present, mention them only when they are grounded in the evidence and useful to the merchant.",
    "If product content is missing, incoherent, too short, contradictory, or clearly about the wrong product, include that in the finding or recommendations when relevant.",
    "When you quote exact customer wording, return-note text, refund-note text, review text, product-description text, title text, tag text, collection text, SKU/variant names, or any other source excerpt, wrap the exact excerpt in double quotation marks. Do not present exact source text without quotation marks.",
    "For evidence_synthesis_sections, write three intermediate qualitative synthesis sections for the AI Evidence Synthesis tab, not one entry per UI tab. Do not restate concrete counts, rates, scores, amounts, or dates unless a specific number is essential to understand the issue; those values are already visible in the product panels.",
    "The three overview evidence_synthesis_sections must be: customer_language for overall customer/product language, product_orders_retention for product setup, variants, Shopify orders, retention and LTV, and post_purchase for refunds, returns and negative reviews. Each body should generalize that evidence group into one merchant-facing reading: what the relationship suggests, what to compare next, and how cautiously to interpret the data. Use only the supplied evidence and avoid inventing new facts.",
    "For retention and LTV, use deterministic.metrics.productRetention only. Its retention rates use rateScale fraction_0_to_1, so 0.24 means 24%. Mention retention briefly only when productRetention.shouldMention is true because it shows a clear retention risk, repeat-purchase strength, cross-sell opportunity, same-product repurchase pattern, or meaningful LTV movement. If retention is unavailable, low-sample, or not material to the product risk/opportunity, do not force it into the main finding or recommendations.",
    "Also write basket_context_interpretation for the Basket context card only when deterministic.metrics.productPurchaseContextSummary includes purchase-context data. This text is generated only during product diagnosis and will be stored; the frontend will not synthesize it at render time.",
    "For basket_context_interpretation, use mostly qualitative interpretation with as few numeric values as possible. Do not recap the visible bar percentages or counts. Explain what the basket, unit, variant, co-purchase, return/refund, review, content and final-report context imply together.",
    "Keep basket_context_interpretation consistent with the main_finding_detail and evidence_summary you return in this same JSON, so it reads as an interpretation of the product diagnosis rather than a standalone metric explanation.",
    "If purchase context is unavailable or too thin to interpret, return an empty string for basket_context_interpretation.",
    "When review evidence comes from multiple providers, you may also create separate evidence_synthesis_sections entries for each review provider so provider tabs can show scoped interpretation. Set source_title and source_key for provider-specific review sections, and do not reuse the same body across CSV, Judge.me, Yotpo, Loox, or any other external review provider.",
    "Only write a provider-specific section from that provider's own review evidence. Do not mix CSV review text into Judge.me, Yotpo, or Loox sections, do not mix provider review text into CSV sections, and do not use the aggregate Customer Language section as a substitute for a provider tab.",
    "Do not put low-priority metadata coverage suggestions, such as product type/tags/collections not being repeated in the description, in the main finding unless they create a real buyer-facing contradiction.",
    "For subjective negative reactions, avoid overstating risk from a single customer. Explain it as a monitor/review signal unless repeated evidence supports action.",
    "Respect deterministic.signalRelevance. If it says reviewSignals level is weak, do not lead the main finding with review language. If customerEvidence level is isolated, treat that signal as evidence to monitor, not as a confirmed issue. If it is emerging, describe it as early evidence with limited confidence. Give priority to returns, refunds, repeated customer language, product content issues, and multi-source agreement.",
    "Write main_finding_detail as exactly five merchant-facing text blocks separated by two newline characters.",
    "Block 1 must be one concise descriptive overview paragraph that summarizes the full diagnosis: the most important finding, the strongest supporting evidence, the relevant calculated context, and the practical merchant implication. Compress what used to be multiple overview paragraphs into this single paragraph.",
    "Blocks 2 through 5 must each answer one key question, using these exact English question headings followed by the answer in the same block: What is wrong? Why do we believe that? What should we do now? How much does it matter?",
    "For the four question blocks, keep the heading and answer together in the same paragraph, for example: What is wrong? The product is...",
    "Do not add extra questions, bullets, markdown headings, numbering, or more than five blocks.",
    "Do not let reviews consume the whole main finding when product description, title, tags, collections, returns, refunds, variants, or customer-language evidence also exists. Cover every relevant discovery group in descending evidence support, and skip only areas with no evidence.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      main_finding_title: "Sizing and fit expectations are not being met",
      main_finding_detail: "One overview paragraph.\\n\\nWhat is wrong? Direct answer grounded in the strongest issue pattern.\\n\\nWhy do we believe that? Direct answer grounded in source agreement and evidence support.\\n\\nWhat should we do now? Direct answer with the next practical merchant action.\\n\\nHow much does it matter? Direct answer explaining impact, risk, confidence, and urgency without overusing visible numbers.",
      evidence_summary: "1-2 sentence source agreement summary",
      basket_context_interpretation: "Concise qualitative Basket context interpretation that uses the final report, overview context, purchase context, and other product signals together while avoiding unnecessary numbers.",
      evidence_synthesis_sections: [
        {
          section_key: "customer_language",
          title: "Customer language",
          body: "One qualitative overview of the customer/product language across reviews, return notes, refund notes, and other supplied text evidence.",
        },
        {
          section_key: "product_orders_retention",
          title: "Product, orders and retention",
          body: "One qualitative overview of product setup, variants, order behavior, retention, LTV, and whether the evidence reads as SKU-specific or product-wide.",
        },
        {
          section_key: "post_purchase",
          title: "Returns, refunds and negative reviews",
          body: "One qualitative overview of post-purchase quality pressure from returns, refunds, negative reviews, support language, and quality-related friction.",
        },
        {
          section_key: "customer_language",
          source_key: "csv_reviews",
          source_title: "CSV reviews",
          title: "Customer language",
          body: "Qualitative interpretation specific to CSV review evidence only.",
        },
        {
          section_key: "customer_language",
          source_key: "judgeme_reviews",
          source_title: "Judge.me reviews",
          title: "Customer language",
          body: "Qualitative interpretation specific to Judge.me review evidence only.",
        },
        {
          section_key: "customer_language",
          source_key: "yotpo_reviews",
          source_title: "Yotpo reviews",
          title: "Customer language",
          body: "Qualitative interpretation specific to Yotpo review evidence only.",
        },
        {
          section_key: "customer_language",
          source_key: "loox_reviews",
          source_title: "Loox reviews",
          title: "Customer language",
          body: "Qualitative interpretation specific to Loox review evidence only.",
        },
      ],
      issue_names: [{ code: "fit_sizing.runs_small", label: "Runs small" }],
      recommendation_copy: {
        pdp_copy: "merchant-ready product page copy",
        product_description: "rewritten product description draft when product content has issues",
        product_title: "clearer Shopify product title when the current title is generic or misleading",
        media_guidance: "short merchant instruction for missing/unclear product imagery or alt text",
        specs_details_block: "Technical details to confirm before buying:\n- Capacity: [confirm capacity]\n- Compatibility: [confirm compatibility]\n- Care: [confirm care instructions]",
        qa_note: "short internal QA/vendor review note when physical quality, safety, durability, refund or return evidence supports it",
        faq_question: "How does this product fit?",
        faq_answer: "merchant-ready FAQ answer",
        faq_items: [
          {
            question: "How does this product fit?",
            answer: "Merchant-ready FAQ answer grounded in the supplied evidence.",
            reason: "Repeated fit and sizing signals need pre-purchase guidance.",
          },
        ],
        support_note: "short internal support note",
      },
    }, null, 2),
    "Product:",
    JSON.stringify(input?.product || {}, null, 2),
    "Deterministic metrics:",
    JSON.stringify(input?.deterministic || {}, null, 2),
    "AI classification:",
    JSON.stringify(classification || {}, null, 2),
    "PDP content gaps:",
    JSON.stringify(contentGaps || {}, null, 2),
    "Emergent customer sentiments:",
    JSON.stringify(emergentSentiments || {}, null, 2),
    "Recommendation candidates chosen by rules:",
    JSON.stringify(input?.recommendationCandidates || [], null, 2),
  ].join("\n\n");
}

function buildContentCoverageValidationPrompt(input, report, contentGaps) {
  const product = input?.product || {};
  const candidates = buildContentCoverageValidationCandidates(report);
  if (!candidates.length) return "";

  return [
    "You are validating whether proposed Shopify product-page copy is already covered by the current product page.",
    "This is a duplicate-prevention step. Do not judge metrics, risk, impact, tone, or priority.",
    "Read the current product description and existing FAQ content semantically. Wording does not need to match exactly.",
    "For every candidate, decide whether its buyer-facing information is already present, partially present, or not present.",
    "Mark FAQ candidates as already_covered when the same buyer question is already answered by the description or an existing FAQ, even if the question uses different words.",
    "If a general FAQ is already answered and only one narrow detail is new, prefer remaining_text for the narrow detail and recommended_application description_note, not another duplicate FAQ.",
    "Treat higher-priority proposed notes as context too: if pdp_copy or another proposed note already carries the only new detail, FAQ candidates repeating that detail should be already_covered or partially_covered with no remaining FAQ answer.",
    "If a candidate is partially covered, return only the missing merchant-ready buyer-facing text in remaining_text. Do not return instructions like add a note, create a FAQ, this note is based on, or description says.",
    "Use confidence high only when the current content clearly covers or clearly lacks the candidate. Use medium for close semantic paraphrases. Use low if uncertain.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      coverage: [{
        id: "faq_item_1",
        status: "already_covered|partially_covered|not_covered|unclear",
        confidence: "low|medium|high",
        recommended_application: "skip|description_note|faq|description_addendum|keep_original",
        matched_existing_text: "short quote or paraphrase from current product content",
        remaining_text: "only the missing buyer-facing text, empty if fully covered",
        remaining_question: "FAQ question only when a new FAQ is still needed",
        remaining_answer: "FAQ answer only when a new FAQ is still needed",
        reason: "brief explanation",
      }],
      summary: "brief validation summary",
    }, null, 2),
    "Current product content:",
    JSON.stringify({
      title: product.title,
      handle: product.handle,
      description: String(product.description || "").slice(0, 7000),
      description_html_excerpt: product.descriptionHtml ? String(product.descriptionHtml).slice(0, 7000) : "",
      options: product.options || [],
      variants: (product.variants || []).slice(0, 50),
    }, null, 2),
    "PDP content-gap analysis:",
    JSON.stringify({
      present: contentGaps?.present || [],
      missing: contentGaps?.missing || [],
      content_issues: contentGaps?.content_issues || [],
      issue_specific_gaps: contentGaps?.issue_specific_gaps || [],
    }, null, 2),
    "Proposed copy candidates to validate:",
    JSON.stringify(candidates, null, 2),
  ].join("\n\n");
}

function buildContentCoverageValidationCandidates(report = {}) {
  const copy = report?.recommendation_copy || {};
  const candidates = [];
  const add = (candidate) => {
    const text = [candidate.text, candidate.question, candidate.answer].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!candidate.id || !text) return;
    candidates.push(candidate);
  };

  add({
    id: "pdp_copy",
    kind: "description_note",
    priority: 1,
    text: String(copy.pdp_copy || "").trim(),
  });
  add({
    id: "product_description",
    kind: "product_description",
    priority: 2,
    text: String(copy.product_description || "").trim(),
  });
  add({
    id: "specs_details_block",
    kind: "description_addendum",
    priority: 3,
    text: String(copy.specs_details_block || copy.specs_block || "").trim(),
  });

  (Array.isArray(copy.faq_items) ? copy.faq_items : []).slice(0, 8).forEach((item, index) => {
    add({
      id: `faq_item_${index + 1}`,
      kind: "faq",
      priority: 4,
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim(),
      reason: String(item?.reason || "").trim(),
    });
  });

  if (copy.faq_question || copy.faq_answer) {
    add({
      id: "legacy_faq",
      kind: "faq",
      priority: 4,
      question: String(copy.faq_question || "").trim(),
      answer: String(copy.faq_answer || "").trim(),
    });
  }

  return candidates.slice(0, 14);
}

function buildActionRationalePrompt(input, classification, contentGaps, emergentSentiments, report) {
  return [
    "You are ProductPulse AI explaining recommended actions to a merchant.",
    "Use a medium-depth explanation: clear and specific, but short. Do not write generic text like \"signals indicate this\" without saying which signals and what they mean.",
    "For each recommendation candidate, write one concise rationale for the modal section \"Why this action\".",
    "Explain: what ProductPulse found, which evidence groups support it, and why this exact action is a reasonable next step.",
    "Use only the supplied data. Do not invent counts, dates, quotes, sources, or product facts.",
    "When quoting exact customer wording, return-note text, refund-note text, review text, product-description text, title text, tags, collections, SKUs, or variant names, wrap the exact excerpt in double quotation marks.",
    "Keep each rationale to one short paragraph, ideally 35 to 75 words.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      action_rationales: [{
        action_id: "add-product-description-guidance",
        rationale: "ProductPulse recommends updating the description because return notes and content analysis point to the same buyer confusion: shoppers are missing a specific product detail before purchase. Adding that clarification to the PDP gives buyers the relevant context before checkout and can reduce avoidable returns.",
      }],
    }, null, 2),
    "Product:",
    JSON.stringify(input?.product || {}, null, 2),
    "Deterministic metrics:",
    JSON.stringify(input?.deterministic || {}, null, 2),
    "Recommendation candidates:",
    JSON.stringify(input?.recommendationCandidates || [], null, 2),
    "AI classification:",
    JSON.stringify(classification || {}, null, 2),
    "PDP content gaps:",
    JSON.stringify(contentGaps || {}, null, 2),
    "Emergent customer sentiments:",
    JSON.stringify(emergentSentiments || {}, null, 2),
    "Final report draft:",
    JSON.stringify(report || {}, null, 2),
  ].join("\n\n");
}

const PRODUCT_CHART_INTERPRETATION_DEFINITIONS = [
  { responseKey: "monthly_order_activity", outputKey: "monthlyOrderActivity", label: "Monthly Order Activity" },
  { responseKey: "return_rate_prediction", outputKey: "returnRatePrediction", label: "Return Rate Prediction" },
  { responseKey: "product_retention_metrics", outputKey: "productRetentionMetrics", label: "Product Retention Metrics" },
  { responseKey: "product_risk_over_time", outputKey: "productRiskOverTime", label: "Product Risk Over Time" },
  { responseKey: "product_momentum", outputKey: "productMomentum", label: "Sales Momentum" },
];

export function buildCompactProductChartInterpretationInput(input = {}) {
  const metrics = input?.deterministic?.metrics || {};
  const product = input?.product || {};
  const charts = {
    monthly_order_activity: compactMonthlyOrderActivityForAi(metrics.monthlyOrderActivity),
    return_rate_prediction: compactReturnRatePredictionForAi(metrics.returnRatePrediction),
    product_retention_metrics: compactProductRetentionForAi(metrics.productRetention),
    product_risk_over_time: compactProductRiskHistoryForAi(metrics, input?.deterministic),
    product_momentum: compactProductMomentumForAi(metrics.productMomentum),
  };

  return {
    available: Object.values(charts).some((chart) => chart.available),
    product: {
      title: cleanRelationshipText(product.title || product.productTitle || "Shopify product", 160),
      handle: cleanRelationshipText(product.handle || "", 120),
    },
    instruction: "Interpret the actual business story in each chart, not generic metric definitions.",
    charts,
  };
}

function buildProductChartInterpretationsPrompt(compactInput) {
  return [
    "You are ProductPulse AI writing short business interpretations for Shopify product-detail charts.",
    "The merchant already sees the chart labels. Do not explain what each metric generally means.",
    "Instead, interpret what the supplied values, dates, direction, volatility, forecast and gaps say about this specific product as a business signal.",
    "Write for a store owner or operator: what can they conclude, what tension is visible, and what deserves attention.",
    "Use only supplied data. Do not invent facts, causes, exact values, dates, trends, products, customers, or recommendations not supported by the data.",
    "Keep each chart answer to one short paragraph, ideally 35 to 75 words and never more than 90 words.",
    "If a chart has unavailable or too-thin data, return an empty string for that chart.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      chart_interpretations: {
        monthly_order_activity: "One concise business interpretation paragraph, or empty string.",
        return_rate_prediction: "One concise business interpretation paragraph, or empty string.",
        product_retention_metrics: "One concise business interpretation paragraph, or empty string.",
        product_risk_over_time: "One concise business interpretation paragraph, or empty string.",
        product_momentum: "One concise business interpretation paragraph, or empty string.",
      },
    }, null, 2),
    "Compact chart data:",
    JSON.stringify(compactInput, null, 2),
  ].join("\n\n");
}

export function normalizeProductChartInterpretations(raw = null, compactInput = {}, modelSummary = null) {
  const rawMap = raw?.chart_interpretations || raw?.chartInterpretations || raw?.interpretations || raw || {};
  const charts = compactInput?.charts || {};
  const interpretations = {};

  PRODUCT_CHART_INTERPRETATION_DEFINITIONS.forEach((definition) => {
    const chartInput = charts[definition.responseKey] || charts[definition.outputKey] || {};
    const rawValue = rawMap[definition.responseKey] || rawMap[definition.outputKey] || "";
    const text = sanitizeChartInterpretationText(typeof rawValue === "string" ? rawValue : rawValue?.text || rawValue?.summary || rawValue?.interpretation || "");
    interpretations[definition.outputKey] = {
      chartId: definition.outputKey,
      label: definition.label,
      available: Boolean(chartInput.available),
      text: chartInput.available ? text : "",
    };
  });

  const hasText = Object.values(interpretations).some((item) => item.text);
  return {
    available: Boolean(compactInput.available),
    status: raw?.status || (compactInput.available ? (hasText ? "available" : "no_ai_interpretation") : "not_available"),
    insightVersion: "product_chart_interpretations_v1",
    generatedAt: hasText ? new Date().toISOString() : null,
    model: modelSummary?.model || null,
    interpretations,
    deterministicInputs: {
      availableChartCount: Object.values(charts).filter((chart) => chart.available).length,
    },
  };
}

function compactMonthlyOrderActivityForAi(activity = null) {
  const months = (Array.isArray(activity?.months) ? activity.months : [])
    .slice(-14)
    .map((month) => ({
      key: cleanRelationshipText(month.key || month.label || "", 32),
      label: cleanRelationshipText(month.label || month.key || "", 40),
      startAt: month.startAt || null,
      orders: toAiNumber(month.orders),
      orderUnits: toAiNumber(month.orderUnits),
      returnedOrders: toAiNumber(month.returnedOrders),
      returnedUnits: toAiNumber(month.returnedUnits),
      refundedOrders: toAiNumber(month.refundedOrders),
      refundedUnits: toAiNumber(month.refundedUnits),
      revenue: toAiNumber(month.revenue),
      refundAmount: toAiNumber(month.refundAmount),
      returnRate: toAiNumber(month.returnRate),
      refundRate: toAiNumber(month.refundRate),
      resolvedReturnUnits: toAiOptionalNumber(month.resolvedReturnUnits ?? month.returnResolvedUnits ?? month.resolvedReturns),
      unresolvedReturnUnits: toAiOptionalNumber(month.unresolvedReturnUnits ?? month.openReturnUnits ?? month.pendingReturnUnits ?? month.unresolvedReturns),
    }));
  const unresolvedSeries = buildAiUnresolvedReturnSeries(months);
  const summary = activity?.summary || {};
  const hasActivity = months.some((month) => month.orders || month.orderUnits || month.returnedUnits || month.refundedUnits || month.revenue || month.refundAmount);

  return {
    available: hasActivity,
    source: cleanRelationshipText(activity?.source || "", 80),
    windowDays: toAiNumber(activity?.windowDays),
    generatedAt: activity?.generatedAt || null,
    summary: {
      totalOrders: toAiNumber(summary.totalOrders),
      totalOrderUnits: toAiNumber(summary.totalOrderUnits),
      totalRevenue: toAiNumber(summary.totalRevenue),
      totalReturnedUnits: toAiNumber(summary.totalReturnedUnits),
      totalRefundedUnits: toAiNumber(summary.totalRefundedUnits),
      totalRefundAmount: toAiNumber(summary.totalRefundAmount),
      returnRate: toAiNumber(summary.returnRate),
      refundRate: toAiNumber(summary.refundRate),
    },
    months,
    unresolvedReturnBalance: unresolvedSeries,
  };
}

function compactReturnRatePredictionForAi(prediction = null) {
  const observedPoints = (Array.isArray(prediction?.observedPoints) ? prediction.observedPoints : [])
    .slice(-16)
    .map((point) => ({
      key: cleanRelationshipText(point.key || point.label || "", 32),
      label: cleanRelationshipText(point.label || point.key || "", 40),
      startAt: point.startAt || null,
      orders: toAiNumber(point.orders),
      orderUnits: toAiNumber(point.orderUnits),
      returnedOrders: toAiNumber(point.returnedOrders),
      returnedUnits: toAiNumber(point.returnedUnits),
      rawReturnRate: toAiOptionalNumber(point.rawReturnRate),
      smoothedReturnRate: toAiNumber(point.smoothedReturnRate ?? point.rawReturnRate),
    }));
  const forecastPoints = (Array.isArray(prediction?.forecastPoints) ? prediction.forecastPoints : [])
    .slice(0, 14)
    .map((point) => ({
      key: cleanRelationshipText(point.key || point.label || "", 32),
      label: cleanRelationshipText(point.label || point.key || "", 40),
      startAt: point.startAt || null,
      predictedReturnRate: toAiNumber(point.predictedReturnRate),
      basePredictedReturnRate: toAiOptionalNumber(point.basePredictedReturnRate),
      baselineReturnRate: toAiOptionalNumber(point.baselineReturnRate),
      seasonalReturnRate: toAiOptionalNumber(point.seasonalReturnRate),
    }));
  const summary = prediction?.summary || {};
  const actionAdjustment = prediction?.actionAdjustment || {};
  const hasPrediction = observedPoints.some((point) => point.orders || point.orderUnits || point.returnedUnits || point.smoothedReturnRate)
    || forecastPoints.some((point) => point.predictedReturnRate);

  return {
    available: hasPrediction,
    source: cleanRelationshipText(prediction?.source || "", 80),
    granularity: cleanRelationshipText(prediction?.granularity || "weekly", 32),
    windowDays: toAiNumber(prediction?.windowDays),
    generatedAt: prediction?.generatedAt || null,
    summary: {
      totalOrderUnits: toAiNumber(summary.totalOrderUnits),
      totalReturnedUnits: toAiNumber(summary.totalReturnedUnits),
      totalReturnRate: toAiNumber(summary.totalReturnRate),
      last30DayReturnRate: toAiNumber(summary.last30DayReturnRate),
      last60DayReturnRate: toAiNumber(summary.last60DayReturnRate),
      forecastNext90ReturnRate: toAiNumber(summary.forecastNext90ReturnRate),
      confidence: cleanRelationshipText(summary.confidence || "", 40),
    },
    actionAdjustment: {
      adjustmentPoints: toAiOptionalNumber(actionAdjustment.adjustmentPoints),
      uncertaintyLift: toAiOptionalNumber(actionAdjustment.uncertaintyLift),
      applied: toAiNumber(actionAdjustment.applied),
      reviewed: toAiNumber(actionAdjustment.reviewed),
      dismissed: toAiNumber(actionAdjustment.dismissed),
      pending: toAiNumber(actionAdjustment.pending),
      total: toAiNumber(actionAdjustment.total),
    },
    observedPoints,
    forecastPoints,
  };
}

function compactProductRetentionForAi(retention = null) {
  const summary = retention?.summary || (retention ? {
    totalCustomersAnalyzed: retention.totalCustomersAnalyzed ?? retention.totalProductCohortCustomers,
    totalOrdersAnalyzed: retention.totalOrdersAnalyzed ?? retention.totalProductOrdersAnalyzed,
    repeatPurchaseRate90d: retention.repeatPurchaseRate90d,
    repeatPurchaseRate180d: retention.repeatPurchaseRate180d,
    sameProductRepurchaseRate90d: retention.sameProductRepurchaseRate90d,
    crossSellRetentionRate90d: retention.crossSellRetentionRate90d,
    returningRevenueShare: retention.returningRevenueShare,
    medianDaysToSecondPurchase: retention.medianDaysToSecondPurchase,
    productLtv90Cents: retention.productLtv90Cents,
    productLtv180Cents: retention.productLtv180Cents,
    retentionHealthScore: retention.retentionHealthScore,
    hasEnoughData: retention.hasEnoughData,
    earliestOrderDate: retention.earliestOrderDate,
    latestOrderDate: retention.latestOrderDate,
  } : {});
  const retentionTrendSource = Array.isArray(retention?.retentionHealthTrend)
    ? retention.retentionHealthTrend
    : Array.isArray(retention?.trend)
      ? retention.trend
      : [];
  const healthTrend = retentionTrendSource
    .slice(-12)
    .map((point) => ({
      date: cleanRelationshipText(point.date || point.asOfDate || point.cohortDate || "", 32),
      retentionHealthScore: toAiOptionalNumber(point.retentionHealthScore),
      repeatPurchaseRate90d: toAiOptionalNumber(point.repeatPurchaseRate90d),
      productLtv90Cents: toAiOptionalNumber(point.productLtv90Cents),
    }));
  const ltvCurve = (Array.isArray(retention?.ltvCurve) ? retention.ltvCurve : [])
    .slice(0, 12)
    .map((point) => ({
      ageDay: toAiNumber(point.ageDay),
      cumulativeLtvCents: toAiNumber(point.cumulativeLtvCents),
      sameProductLtvCents: toAiNumber(point.sameProductLtvCents),
      otherProductLtvCents: toAiNumber(point.otherProductLtvCents),
    }));
  const hasRetention = Boolean(retention?.available)
    || (Object.keys(summary).length > 0
      && (toAiNumber(summary.totalCustomersAnalyzed) > 0 || toAiOptionalNumber(summary.retentionHealthScore) !== null || healthTrend.length > 0 || ltvCurve.length > 0));

  return {
    available: hasRetention,
    run: retention?.run || null,
    summary: {
      totalCustomersAnalyzed: toAiNumber(summary.totalCustomersAnalyzed),
      totalOrdersAnalyzed: toAiNumber(summary.totalOrdersAnalyzed),
      repeatPurchaseRate90d: toAiOptionalNumber(summary.repeatPurchaseRate90d),
      repeatPurchaseRate180d: toAiOptionalNumber(summary.repeatPurchaseRate180d),
      sameProductRepurchaseRate90d: toAiOptionalNumber(summary.sameProductRepurchaseRate90d),
      crossSellRetentionRate90d: toAiOptionalNumber(summary.crossSellRetentionRate90d),
      returningRevenueShare: toAiOptionalNumber(summary.returningRevenueShare),
      medianDaysToSecondPurchase: toAiOptionalNumber(summary.medianDaysToSecondPurchase),
      productLtv90Cents: toAiOptionalNumber(summary.productLtv90Cents),
      productLtv180Cents: toAiOptionalNumber(summary.productLtv180Cents),
      retentionHealthScore: toAiOptionalNumber(summary.retentionHealthScore),
      hasEnoughData: Boolean(summary.hasEnoughData),
      earliestOrderDate: summary.earliestOrderDate || null,
      latestOrderDate: summary.latestOrderDate || null,
    },
    retentionHealthTrend: healthTrend,
    ltvCurve,
  };
}

function compactProductRiskHistoryForAi(metrics = {}, deterministic = {}) {
  const history = Array.isArray(metrics.reconstructedRiskHistory)
    ? metrics.reconstructedRiskHistory
    : Array.isArray(metrics.riskHistory)
      ? metrics.riskHistory
      : [];
  const points = history.slice(-16).map((point, index) => ({
    label: cleanRelationshipText(point.label || point.recordedAt || point.calculatedAt || `Point ${index + 1}`, 48),
    recordedAt: point.recordedAt || point.calculatedAt || point.completedAt || null,
    riskScore: toAiNumber(point.riskScore),
    confidence: toAiOptionalNumber(point.confidence),
    returnRate: toAiOptionalNumber(point.returnRate),
    refundRate: toAiOptionalNumber(point.refundRate),
    returnUnits: toAiOptionalNumber(point.returnUnits),
    refundUnits: toAiOptionalNumber(point.refundUnits),
    negativeReviewCount: toAiOptionalNumber(point.negativeReviewCount),
    reviewCount: toAiOptionalNumber(point.reviewCount),
    avgRating: toAiOptionalNumber(point.avgRating ?? point.averageRating),
    refundAmount: toAiOptionalNumber(point.refundAmount),
    productMomentumScore: toAiOptionalNumber(point.productMomentumScore),
  }));
  const currentRiskScore = toAiOptionalNumber(deterministic?.riskScore ?? metrics.riskScore ?? metrics.riskComponents?.riskScore);
  const hasRisk = points.length > 0 || currentRiskScore !== null;

  return {
    available: hasRisk,
    current: {
      riskScore: currentRiskScore,
      confidence: toAiOptionalNumber(deterministic?.confidence ?? metrics.confidence),
      riskLabel: cleanRelationshipText(deterministic?.riskLabel || metrics.riskLabel || "", 40),
      riskTrend: cleanRelationshipText(typeof metrics.riskTrend === "string" ? metrics.riskTrend : metrics.riskTrendLabel || "", 80),
    },
    points,
  };
}

function compactProductMomentumForAi(momentum = null) {
  const components = momentum?.components || {};
  const inputs = momentum?.inputs || {};
  const display = momentum?.display || {};
  const weeklyUnits = Array.isArray(inputs.weeklyUnitsLast4Weeks)
    ? inputs.weeklyUnitsLast4Weeks.slice(-4).map(toAiNumber)
    : [];
  const hasMomentum = momentum && (
    toAiOptionalNumber(momentum.score) !== null
    || weeklyUnits.some((value) => value > 0)
    || toAiNumber(inputs.unitsLast30Days) > 0
    || toAiNumber(inputs.revenueLast30Days) > 0
  );

  return {
    available: Boolean(hasMomentum),
    score: toAiOptionalNumber(momentum?.score),
    tier: cleanRelationshipText(momentum?.tier || "", 40),
    direction: cleanRelationshipText(momentum?.direction || "", 40),
    confidence: toAiOptionalNumber(momentum?.confidence),
    confidenceLabel: cleanRelationshipText(momentum?.confidenceLabel || "", 40),
    display: {
      trendLabel: cleanRelationshipText(display.trendLabel || "", 140),
      growthLabel: cleanRelationshipText(display.growthLabel || "", 80),
      growthPercent: toAiOptionalNumber(display.growthPercent),
      catalogPositionLabel: cleanRelationshipText(display.catalogPositionLabel || "", 120),
    },
    components: {
      currentVelocityScore: toAiOptionalNumber(components.currentVelocityScore),
      growthScore: toAiOptionalNumber(components.growthScore),
      catalogShareScore: toAiOptionalNumber(components.catalogShareScore),
      trendConsistencyScore: toAiOptionalNumber(components.trendConsistencyScore),
      recencyScore: toAiOptionalNumber(components.recencyScore),
    },
    inputs: {
      unitsLast7Days: toAiNumber(inputs.unitsLast7Days),
      unitsLast30Days: toAiNumber(inputs.unitsLast30Days),
      unitsPrevious30Days: toAiNumber(inputs.unitsPrevious30Days),
      revenueLast30Days: toAiNumber(inputs.revenueLast30Days),
      weeklyUnitsLast4Weeks: weeklyUnits,
      lastSaleAt: inputs.lastSaleAt || null,
    },
  };
}

function buildAiUnresolvedReturnSeries(months = []) {
  let runningUnresolved = 0;
  return months.map((month) => {
    const opened = Math.max(0, toAiNumber(month.returnedUnits || month.returnedOrders));
    const explicitResolved = toAiOptionalNumber(month.resolvedReturnUnits);
    const explicitUnresolved = toAiOptionalNumber(month.unresolvedReturnUnits);
    const resolved = explicitResolved === null
      ? Math.min(Math.max(0, toAiNumber(month.refundedUnits || month.refundedOrders)), runningUnresolved + opened)
      : Math.max(0, explicitResolved);
    const value = explicitUnresolved === null
      ? Math.max(0, runningUnresolved + opened - resolved)
      : Math.max(0, explicitUnresolved);
    runningUnresolved = value;
    return {
      key: month.key,
      label: month.label,
      openedReturns: opened,
      resolvedReturns: resolved,
      unresolvedReturnBalance: value,
    };
  });
}

function sanitizeChartInterpretationText(value = "") {
  return cleanAiParagraph(value)
    .replace(/\b(?:causes?|caused|causing|causally|because it causes)\b/gi, "is associated with")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 620);
}

function toAiNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return roundAiNumber(numeric, 2);
}

function toAiOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return roundAiNumber(numeric, 2);
}

export function buildCompactProductRelationshipAiInput(input = {}) {
  const metrics = input?.deterministic?.metrics || {};
  const factors = metrics.productRelationshipFactors || {};
  const aiInput = factors.aiInsightInput || {};
  const summary = metrics.productRelationshipIntelligenceSummary || {};
  const relationships = uniqueRelationshipsForAi([
    ...(aiInput.topRelationships || []),
    ...(aiInput.riskRelationships || []),
    ...(aiInput.crossSellOpportunities || []),
    ...(summary.strongest_relationships || []),
    ...(summary.relationships_with_return_risk_impact || []),
    ...(summary.relationships_with_cross_sell_opportunity || []),
  ].map(sanitizeRelationshipForAi).filter(Boolean));
  const confidence = aiInput.confidence || summary.confidence || {};
  const product = input?.product || {};

  return {
    available: relationships.length > 0,
    product: {
      title: cleanRelationshipText(product.title || product.productTitle || "Shopify product", 160),
      handle: cleanRelationshipText(product.handle || "", 120),
    },
    confidence: {
      score: normalizeAiPercent(confidence.score),
      label: cleanRelationshipText(confidence.label || "", 40),
    },
    warnings: arrayOfSafeStrings(aiInput.warnings || summary.warnings).slice(0, 6),
    deterministicExplanations: arrayOfSafeStrings(metrics.productRelationshipScoringImpact).slice(0, 5),
    relationships,
  };
}

function buildProductRelationshipInsightsPrompt(compactInput) {
  return [
    "You are ProductPulse AI writing compact product relationship insights for a Shopify merchant.",
    "The system already calculated every number. Use only the supplied relationships and source_relationship_id values.",
    "Do not invent relationships, product names, percentages, counts, time windows, lifts, or confidence. Do not mention customers individually. Do not expose PII.",
    "Do not claim causality. Use words like association, pattern, relationship, context, or opportunity.",
    "Do not recommend direct Shopify mutations or say changes were applied. Recommendations must be review-oriented.",
    "If confidence or sample size is low, include a caveat.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      insights: [{
        source_relationship_id: "relatedProductId:direction:timeWindow",
        type: "bundle_opportunity|cross_sell_opportunity|compatibility_context|journey_context|confidence_caveat",
        summary: "One concise merchant-facing sentence.",
        recommendation: "One concise review-oriented next step, or empty string.",
        caveat: "Low-confidence caveat when relevant, or empty string.",
      }],
    }, null, 2),
    "Sanitized deterministic relationship input:",
    JSON.stringify(compactInput, null, 2),
  ].join("\n\n");
}

export function normalizeProductRelationshipAiInsights(raw = null, compactInput = {}, modelSummary = null) {
  const relationships = Array.isArray(compactInput.relationships) ? compactInput.relationships : [];
  const sourceById = new Map(relationships.map((item) => [item.sourceRelationshipId, item]));
  const rawInsights = Array.isArray(raw?.insights)
    ? raw.insights
    : Array.isArray(raw?.relationship_insights)
      ? raw.relationship_insights
      : [];
  const insights = rawInsights
    .map((item, index) => {
      const sourceRelationshipId = cleanRelationshipText(item?.source_relationship_id || item?.sourceRelationshipId || "", 180);
      const source = sourceById.get(sourceRelationshipId);
      if (!source) return null;
      const confidence = normalizeAiPercent(source.confidence);
      const sampleSize = Number(source.sampleSize || 0);
      const caveat = sanitizeRelationshipInsightText(item?.caveat || "");
      const lowConfidenceCaveat = confidence > 0 && (confidence < 55 || sampleSize < 3)
        ? "Low confidence: this relationship has limited sample size."
        : "";
      return {
        id: `relationship-insight-${index + 1}`,
        type: cleanRelationshipText(item?.type || "relationship_context", 80),
        sourceRelationshipId,
        relatedProductTitle: source.relatedProductTitle,
        summary: sanitizeRelationshipInsightText(item?.summary || item?.insight || ""),
        recommendation: sanitizeRelationshipInsightText(item?.recommendation || ""),
        caveat: caveat || lowConfidenceCaveat,
        metrics: {
          relationshipType: source.relationshipType,
          direction: source.direction,
          timeWindow: source.timeWindow,
          lift: source.lift,
          confidence,
          sampleSize,
          relationshipStrength: source.relationshipStrength,
          trend: source.trend,
          deltaReturnRate: source.deltaReturnRate,
          deltaRefundRate: source.deltaRefundRate,
        },
      };
    })
    .filter((item) => item && item.summary)
    .slice(0, 5);

  return {
    available: Boolean(compactInput.available),
    status: compactInput.available ? (raw?.status || (insights.length ? "available" : "no_ai_insights")) : "not_available",
    insightVersion: "product_relationship_ai_insight_v1",
    generatedAt: insights.length ? new Date().toISOString() : null,
    model: modelSummary?.model || null,
    insights,
    deterministicInputs: {
      relationshipCount: relationships.length,
      confidenceScore: compactInput.confidence?.score || 0,
      warnings: compactInput.warnings || [],
    },
  };
}

function sanitizeRelationshipForAi(item = {}) {
  const relatedProductId = cleanRelationshipText(item.relatedProductId || item.related_product_id || "", 180);
  const direction = cleanRelationshipText(item.direction || item.relationshipDirection || item.relationship_direction || "", 40);
  const timeWindow = cleanRelationshipText(item.timeWindow || item.time_window || "", 40);
  if (!relatedProductId || !direction) return null;
  return {
    sourceRelationshipId: `${relatedProductId}:${direction}:${timeWindow || "none"}`,
    relatedProductId,
    relatedProductTitle: cleanRelationshipText(item.relatedProductTitle || item.related_product_title || "Unknown product", 160),
    relationshipType: cleanRelationshipText(item.relationshipType || item.relationship_type || "", 60),
    direction,
    timeWindow,
    relationshipRate: normalizeAiPercent(item.relationshipRate ?? item.relationship_rate),
    attachRate: normalizeAiPercent(item.attachRate ?? item.attach_rate),
    lift: item.lift === null || item.lift === undefined ? null : roundAiNumber(item.lift, 2),
    relationshipStrength: cleanRelationshipText(item.relationshipStrength || item.relationship_strength || "", 40),
    confidence: normalizeAiPercent(item.confidence),
    confidenceLabel: cleanRelationshipText(item.confidenceLabel || item.confidence_label || "", 40),
    sampleSize: Number(item.sampleSize || item.sample_size || 0),
    trend: cleanRelationshipText(item.trend || "", 40),
    deltaReturnRate: normalizeAiPercent(item.deltaReturnRate ?? item.delta_return_rate),
    deltaRefundRate: normalizeAiPercent(item.deltaRefundRate ?? item.delta_refund_rate),
  };
}

function uniqueRelationshipsForAi(items = []) {
  const byId = new Map();
  items.forEach((item) => {
    if (!item?.sourceRelationshipId || byId.has(item.sourceRelationshipId)) return;
    byId.set(item.sourceRelationshipId, item);
  });
  return Array.from(byId.values()).slice(0, 12);
}

function sanitizeRelationshipInsightText(value = "") {
  return cleanAiParagraph(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\b(?:causes?|caused|causing|causally|because it causes)\b/gi, "is associated with")
    .replace(/\b(?:apply|execute|write|mutate|publish|change)\s+(?:it\s+)?(?:directly\s+)?(?:in|to)\s+Shopify\b/gi, "review in the merchandising workflow")
    .replace(/\b\d+(?:\.\d+)?\s*(?:%|x|orders?|customers?|units?|days?|weeks?|months?|refunds?|returns?)(?=\b|\s|\.|,|;|:|$)/gi, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function cleanRelationshipText(value = "", limit = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function arrayOfSafeStrings(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanRelationshipText(item, 220))
    .filter(Boolean);
}

function normalizeAiPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return roundAiNumber(numeric <= 1 ? numeric * 100 : numeric, 1);
}

function roundAiNumber(value, digits = 1) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function buildProductDiagnosisPrompt(product) {
  const metrics = product.metrics || {};
  const sources = Array.isArray(product.sourceCoverage) ? product.sourceCoverage.join(", ") : "Shopify products";
  const returnReasons = Array.isArray(metrics.topReturnReasons) && metrics.topReturnReasons.length
    ? metrics.topReturnReasons.join(", ")
    : "none captured";

  return [
    "Write one single Spanish test text for ProductPulse AI, around 150 to 210 words.",
    "It should feel clearly AI-generated, a bit imaginative and slightly random, but still useful and product-specific.",
    "This is only a connection test, not a final product diagnosis.",
    `Product title: ${product.title}.`,
    `Handle: ${product.handle || "unknown"}.`,
    `Risk score: ${product.riskScore ?? 0}/100.`,
    `Primary issue: ${product.primaryIssue || "not available"}.`,
    `Stored sources: ${sources}.`,
    `Top return reasons: ${returnReasons}.`,
    "Return only one paragraph. Do not include bullets, markdown, JSON, recommendations or headings.",
  ].join("\n");
}

async function generateAiText({ shop, jobId, task, prompt, usageTracker = null }) {
  const aiRouting = getProductPulseAiRouting();
  const provider = aiRouting.provider;
  const taskConfig = AI_TASKS[task] || AI_TASKS.final_report;
  const startedAt = Date.now();

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.ai_provider_selected",
    message: `Selected ${provider === GEMINI_PROVIDER ? "Gemini" : "OpenAI"} for ${task}.`,
    data: {
      provider,
      task,
      developmentMode: isProductPulseDevelopment(),
      aiLevel: aiRouting.level,
      aiLevelLabel: aiRouting.label,
      modelMode: aiRouting.modelMode,
      configuredBy: aiRouting.configuredBy,
    },
  });

  logProductDiagnosisAiPerf("product_diagnosis.ai_task.started", {
    shop,
    jobId,
    task,
    provider,
    aiLevel: aiRouting.level,
    aiLevelLabel: aiRouting.label,
    modelMode: aiRouting.modelMode,
    promptChars: String(prompt || "").length,
    maxOutputTokens: taskConfig.maxOutputTokens,
  });

  let resolvedResponse;
  try {
    const response = provider === GEMINI_PROVIDER
      ? generateWithGemini({ shop, jobId, task, taskConfig, prompt, usageTracker })
      : generateWithOpenAI({ shop, jobId, task, taskConfig, prompt, usageTracker });
    resolvedResponse = await response;
  } catch (error) {
    logProductDiagnosisAiPerf("product_diagnosis.ai_task.failed", {
      shop,
      jobId,
      task,
      provider,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || null,
      status: error?.status || null,
    }, "error");
    throw error;
  }

  logProductDiagnosisAiPerf("product_diagnosis.ai_task.done", {
    shop,
    jobId,
    task,
    provider: resolvedResponse.provider,
    model: resolvedResponse.model,
    durationMs: Date.now() - startedAt,
    textChars: String(resolvedResponse.text || "").length,
    usage: summarizeAiPerfUsage(resolvedResponse.usage),
  });

  if (!usageTracker) {
    await recordAiUsageEvent({
      shop,
      jobId,
      source: getUsageEventSourceForTask(task),
      operation: task,
      provider: resolvedResponse.provider,
      model: resolvedResponse.model,
      task,
      requestContext: resolvedResponse.usage?.requestContext || "primary",
      usage: resolvedResponse.usage,
    });
  }

  return resolvedResponse;
}

function logProductDiagnosisAiPerf(event, data = {}, level = "warn") {
  if (process.env.NODE_ENV === "test") return;
  const method = level === "error" ? "error" : level === "info" ? "info" : "warn";
  console[method]("[product-pulse-diagnosis-perf]", {
    event,
    at: new Date().toISOString(),
    ...getProductDiagnosisAiMemorySnapshot(),
    ...data,
  });
}

function getProductDiagnosisAiMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: productDiagnosisAiToMb(memory.heapUsed),
    heapTotalMb: productDiagnosisAiToMb(memory.heapTotal),
    rssMb: productDiagnosisAiToMb(memory.rss),
    externalMb: productDiagnosisAiToMb(memory.external),
  };
}

function productDiagnosisAiToMb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function summarizeAiPerfUsage(usage = {}) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0,
    outputTokens: usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens ?? usage.cached_tokens ?? usage.cachedContentTokenCount ?? 0,
    reasoningTokens: usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.thoughtsTokenCount ?? 0,
    usageSource: usage.usageSource || null,
    requestContext: usage.requestContext || null,
  };
}

function getUsageEventSourceForTask(task) {
  if (task === "watch_change_report") return "watchlist";
  if (task === "test_text") return "ai_test";
  return "product_diagnosis";
}

function getProductPulseAiRouting() {
  const level = getProductPulseAiLevel();
  if (level === PRODUCT_PULSE_AI_LEVELS.DEVELOPMENT_GEMINI) {
    return {
      level,
      label: "development_gemini",
      modelMode: "gemini_with_openai_basic_fallback",
      provider: GEMINI_PROVIDER,
      configuredBy: process.env[PRODUCT_PULSE_AI_LEVEL_ENV] == null ? "environment_mode" : PRODUCT_PULSE_AI_LEVEL_ENV,
    };
  }
  if (level === PRODUCT_PULSE_AI_LEVELS.DEVELOPMENT_OPENAI_BASIC) {
    return {
      level,
      label: "development_openai_basic",
      modelMode: "openai_basic_only",
      provider: OPENAI_PROVIDER,
      configuredBy: process.env[PRODUCT_PULSE_AI_LEVEL_ENV] == null ? "environment_mode" : PRODUCT_PULSE_AI_LEVEL_ENV,
    };
  }
  return {
    level: PRODUCT_PULSE_AI_LEVELS.PRODUCTION_TIERED_OPENAI,
    label: "production_tiered_openai",
    modelMode: "openai_tiered",
    provider: OPENAI_PROVIDER,
    configuredBy: process.env[PRODUCT_PULSE_AI_LEVEL_ENV] == null ? "environment_mode" : PRODUCT_PULSE_AI_LEVEL_ENV,
  };
}

function getProductPulseAiLevel() {
  const configured = parseIntegerEnv(process.env[PRODUCT_PULSE_AI_LEVEL_ENV]);
  if (Object.values(PRODUCT_PULSE_AI_LEVELS).includes(configured)) return configured;
  return isProductPulseDevelopment()
    ? PRODUCT_PULSE_AI_LEVELS.DEVELOPMENT_GEMINI
    : PRODUCT_PULSE_AI_LEVELS.PRODUCTION_TIERED_OPENAI;
}

function parseIntegerEnv(value) {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function generateWithOpenAI({ shop, jobId, task, taskConfig, prompt, modelOverride = null, requestContext = "primary", usageTracker = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = modelOverride || resolveOpenAIModel(taskConfig);

  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!model) throw new Error("No OpenAI model is configured.");

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_request",
    message: requestContext === "gemini_fallback"
      ? `Sending ${task} prompt to OpenAI nano after Gemini fallback exhaustion.`
      : `Sending ${task} prompt to OpenAI.`,
    data: { provider: OPENAI_PROVIDER, model, task, requestContext },
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: taskConfig.maxOutputTokens,
      temperature: taskConfig.temperature,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = json.error?.code || json.error?.type || null;
    error.details = json.error || null;
    throw error;
  }

  const text = extractOpenAIText(json);
  if (!text) throw new Error(`OpenAI returned an empty ${task} response.`);
  const usage = recordAiUsage({
    usageTracker,
    provider: OPENAI_PROVIDER,
    model,
    task,
    requestContext,
    usage: json.usage || null,
    usageSource: json.usage ? "openai_response_usage" : "provider_missing",
  });

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_response",
    message: `OpenAI returned ${task}.`,
    data: { provider: OPENAI_PROVIDER, model, task, requestContext, usage, text },
  });

  return { provider: OPENAI_PROVIDER, model, task, usage, text };
}

function resolveOpenAIModel(taskConfig) {
  if (getProductPulseAiLevel() === PRODUCT_PULSE_AI_LEVELS.DEVELOPMENT_OPENAI_BASIC) {
    return resolveOpenAIBasicModel();
  }
  for (const envName of taskConfig.modelEnv || []) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  return taskConfig.fallbackModel;
}

function resolveOpenAIBasicModel() {
  return String(process.env.OPENAI_BASIC_MODEL || "").trim() || "gpt-5.4-nano";
}

function resolveOpenAINanoModel() {
  return resolveOpenAIBasicModel();
}

function extractOpenAIText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n").trim();
}

function recordAiUsage({ usageTracker, provider, model, task, requestContext, usage, usageSource }) {
  const call = { provider, model, task, requestContext, usage, usageSource };
  return usageTracker ? usageTracker.record(call) : normalizeAiUsageCall(call);
}

async function generateWithGemini({ shop, jobId, task, taskConfig, prompt, usageTracker = null }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const models = getGeminiModelPool();
  if (!models.length) throw new Error("No Gemini model is configured.");

  const orderedModels = await getGeminiAttemptOrder(models);
  let lastError = null;
  let lastRetryReason = null;

  for (const [index, model] of orderedModels.entries()) {
    const nextModel = orderedModels[index + 1];
    const primaryAttempt = model === models[0];
    if (primaryAttempt) await rememberGeminiPrimaryRetry(model);

    try {
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_request",
        message: `Sending ${task} prompt to Gemini model ${model}.`,
        data: { provider: GEMINI_PROVIDER, model, task, attempt: index + 1 },
      });

      const geminiResponse = await requestGeminiText({ apiKey, model, prompt, taskConfig });
      const usage = recordAiUsage({
        usageTracker,
        provider: GEMINI_PROVIDER,
        model,
        task,
        requestContext: "primary",
        usage: geminiResponse.usageMetadata || null,
        usageSource: geminiResponse.usageMetadata ? "gemini_usage_metadata" : "provider_missing",
      });
      await rememberGeminiSuccess(model);
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_response",
        message: `Gemini returned ${task}.`,
        data: { provider: GEMINI_PROVIDER, model, task, usage, text: geminiResponse.text },
      });

      return { provider: GEMINI_PROVIDER, model, task, usage, text: geminiResponse.text };
    } catch (error) {
      lastError = error;
      lastRetryReason = getGeminiRetryReason(error);
      if (nextModel && lastRetryReason) {
        await rememberGeminiModelSwitch(nextModel, {
          failedModel: model,
          error,
          reason: lastRetryReason,
        });
      } else {
        await rememberGeminiFailure(model, error);
      }

      const retryingWithGemini = Boolean(nextModel && lastRetryReason);
      const recoveringWithOpenAI = Boolean(!nextModel && shouldFallbackToOpenAINano(lastRetryReason));
      const recoverableFailure = retryingWithGemini || recoveringWithOpenAI;

      await recordJobLog({
        shop,
        jobId,
        level: recoverableFailure ? "warn" : "error",
        event: recoverableFailure ? "product_diagnosis.gemini_model_recovery" : "product_diagnosis.gemini_model_failed",
        message: buildGeminiFailureLogMessage({
          model,
          nextModel,
          retryReason: lastRetryReason,
          openAiFallbackModel: recoveringWithOpenAI ? resolveOpenAINanoModel() : null,
        }),
        data: {
          provider: GEMINI_PROVIDER,
          model,
          nextModel: nextModel || null,
          retryReason: lastRetryReason,
          recovery: nextModel ? "next_gemini_model" : recoveringWithOpenAI ? "openai_nano" : null,
          task,
          ...(recoverableFailure
            ? { providerError: serializeError(error) }
            : { error: serializeError(error) }),
        },
      });

      if (!lastRetryReason) throw error;
      if (!nextModel) {
        await rememberGeminiPoolExhausted(models[0], {
          failedModel: model,
          error,
          reason: lastRetryReason,
        });
        const poolError = buildGeminiPoolExhaustedError(lastRetryReason, error);
        if (shouldFallbackToOpenAINano(lastRetryReason)) {
          return generateWithOpenAINanoAfterGeminiExhaustion({
            shop,
            jobId,
            task,
            taskConfig,
            prompt,
            usageTracker,
            retryReason: lastRetryReason,
            geminiError: poolError,
            lastGeminiError: error,
          });
        }
        throw poolError;
      }

      await sleep(GEMINI_MODEL_RETRY_DELAY_MS);
    }
  }

  const poolError = buildGeminiPoolExhaustedError(lastRetryReason, lastError);
  if (shouldFallbackToOpenAINano(lastRetryReason)) {
    return generateWithOpenAINanoAfterGeminiExhaustion({
      shop,
      jobId,
      task,
      taskConfig,
      prompt,
      usageTracker,
      retryReason: lastRetryReason,
      geminiError: poolError,
      lastGeminiError: lastError,
    });
  }
  throw poolError;
}

function getGeminiModelPool() {
  return uniqueTruthy([
    process.env.GEMINI_MODEL,
    ...String(process.env.GEMINI_MODEL_FALLBACK_POOL || process.env.GEMINI_MODEL_FALLBACK_PUL || "")
      .split(",")
      .map((model) => model.trim()),
  ]);
}

async function getGeminiAttemptOrder(models) {
  const state = await prisma.productPulseAiProviderState.findUnique({
    where: { provider: GEMINI_PROVIDER },
  }).catch(() => null);

  const now = Date.now();
  const lastPrimaryRetry = state?.lastPrimaryRetryAt ? new Date(state.lastPrimaryRetryAt).getTime() : 0;
  const shouldRetryPrimary = !lastPrimaryRetry || now - lastPrimaryRetry >= GEMINI_PRIMARY_RETRY_MS;
  if (shouldRetryPrimary || !state?.currentModel) return models;

  const currentIndex = models.indexOf(state.currentModel);
  if (currentIndex <= 0) return models;
  return models.slice(currentIndex);
}

async function requestGeminiText({ apiKey, model, prompt, taskConfig }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: taskConfig.temperature,
          maxOutputTokens: taskConfig.maxOutputTokens,
        },
      }),
    },
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error?.message || `Gemini request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = json.error?.status || json.error?.code;
    error.details = json.error?.details || json.error || null;
    throw error;
  }

  const text = (json.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) throw new Error("Gemini returned an empty product diagnosis response.");
  return {
    text,
    usageMetadata: json.usageMetadata || null,
  };
}

function getGeminiRetryReason(error) {
  const message = [
    error?.message,
    error?.code,
    error?.name,
    error?.cause?.message,
    error?.cause?.code,
    error?.cause?.name,
    error?.details?.message,
    error?.details?.status,
  ].filter(Boolean).join(" ").toLowerCase();
  if (
    error?.status === 503 ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("try again later") ||
    message.includes("unavailable")
  ) {
    return "high_demand";
  }

  if (
    error?.status === 429 ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("exceeded")
  ) {
    return "quota";
  }

  if (
    (Number(error?.status || 0) >= 500 && Number(error?.status || 0) < 600) ||
    message.includes("internal") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("headers timeout") ||
    message.includes("und_err_headers_timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  ) {
    return "transient";
  }

  if (
    error?.status === 404 ||
    message.includes("not found") ||
    message.includes("model")
  ) {
    return "model_unavailable";
  }

  return null;
}

function shouldFallbackToOpenAINano(retryReason) {
  return retryReason === "high_demand" || retryReason === "quota" || retryReason === "transient";
}

async function generateWithOpenAINanoAfterGeminiExhaustion({
  shop,
  jobId,
  task,
  taskConfig,
  prompt,
  usageTracker,
  retryReason,
  geminiError,
  lastGeminiError,
}) {
  const model = resolveOpenAINanoModel();

  await recordJobLog({
    shop,
    jobId,
    level: "warn",
    event: "product_diagnosis.gemini_pool_exhausted_openai_fallback",
    message: `All configured Gemini models failed due to ${getGeminiRetryReasonLabel(retryReason)}; retrying ${task} with OpenAI nano.`,
    data: {
      provider: OPENAI_PROVIDER,
      model,
      task,
      retryReason,
      geminiError: serializeError(lastGeminiError || geminiError),
    },
  });

  try {
    return await generateWithOpenAI({
      shop,
      jobId,
      task,
      taskConfig,
      prompt,
      modelOverride: model,
      requestContext: "gemini_fallback",
      usageTracker,
    });
  } catch (openAiError) {
    await recordJobLog({
      shop,
      jobId,
      level: "error",
      event: "product_diagnosis.openai_nano_fallback_failed",
      message: "OpenAI nano fallback failed after Gemini pool exhaustion.",
      data: {
        provider: OPENAI_PROVIDER,
        model,
        task,
        retryReason,
        geminiError: serializeError(lastGeminiError || geminiError),
        openAiError: serializeError(openAiError),
      },
    });
    throw buildOpenAINanoFallbackError({ retryReason, geminiError, openAiError });
  }
}

async function rememberGeminiPrimaryRetry(model) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      lastPrimaryRetryAt: new Date(),
      metadata: { reason: "daily_primary_retry" },
    },
    update: {
      currentModel: model,
      lastPrimaryRetryAt: new Date(),
      metadata: { reason: "daily_primary_retry" },
    },
  }).catch(() => {});
}

async function rememberGeminiSuccess(model) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      failureCount: 0,
      metadata: { lastSuccessAt: new Date().toISOString() },
    },
    update: {
      currentModel: model,
      failureCount: 0,
      metadata: { lastSuccessAt: new Date().toISOString() },
    },
  }).catch(() => {});
}

async function rememberGeminiFailure(model, error) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      failureCount: 1,
      metadata: { lastFailureAt: new Date().toISOString(), error: serializeError(error) },
    },
    update: {
      currentModel: model,
      failureCount: { increment: 1 },
      metadata: { lastFailureAt: new Date().toISOString(), error: serializeError(error) },
    },
  }).catch(() => {});
}

async function rememberGeminiModelSwitch(nextModel, { failedModel, error, reason }) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: nextModel,
      failureCount: 1,
      metadata: {
        lastFailureAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
    update: {
      currentModel: nextModel,
      failureCount: { increment: 1 },
      metadata: {
        lastFailureAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
  }).catch(() => {});
}

async function rememberGeminiPoolExhausted(nextModel, { failedModel, error, reason }) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: nextModel,
      failureCount: 1,
      metadata: {
        exhaustedAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
    update: {
      currentModel: nextModel,
      failureCount: { increment: 1 },
      metadata: {
        exhaustedAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
  }).catch(() => {});
}

function buildGeminiFailureLogMessage({ model, nextModel, retryReason, openAiFallbackModel = null }) {
  if (!retryReason) return `Gemini model ${model} failed.`;
  const reasonLabel = getGeminiRetryReasonLabel(retryReason);
  if (nextModel) return `Gemini model ${model} failed due to ${reasonLabel}; retrying with ${nextModel}.`;
  if (openAiFallbackModel) return `Gemini model ${model} failed due to ${reasonLabel}; Gemini pool exhausted, retrying with ${openAiFallbackModel}.`;
  return `Gemini model ${model} failed due to ${reasonLabel}; all configured Gemini models were attempted.`;
}

function buildGeminiPoolExhaustedError(retryReason, error) {
  const detail = formatProviderErrorDetail(error);
  if (retryReason === "high_demand") {
    return new Error(`Product Diagnosis could not be completed because every configured Gemini model is currently under high demand. Gemini detail: ${detail}`);
  }
  if (retryReason === "quota") {
    return new Error(`Product Diagnosis could not be completed because every configured Gemini model hit quota or rate limits. Gemini detail: ${detail}`);
  }
  if (retryReason === "model_unavailable") {
    return new Error(`Product Diagnosis could not be completed because no configured Gemini model is currently available. Gemini detail: ${detail}`);
  }
  if (retryReason === "transient") {
    return new Error(`Product Diagnosis could not be completed because every configured Gemini model hit a temporary provider or network error. Gemini detail: ${detail}`);
  }
  return error || new Error("Product Diagnosis could not be completed with Gemini. Please try again later.");
}

function buildOpenAINanoFallbackError({ retryReason, geminiError, openAiError }) {
  return new Error([
    `Product Diagnosis failed after all Gemini models hit ${getGeminiRetryReasonLabel(retryReason)} and OpenAI nano fallback also failed.`,
    `Gemini: ${formatProviderErrorDetail(geminiError)}.`,
    `OpenAI nano: ${formatProviderErrorDetail(openAiError)}.`,
    "Please try again later.",
  ].join(" "));
}

function getGeminiRetryReasonLabel(retryReason) {
  if (retryReason === "high_demand") return "high demand";
  if (retryReason === "quota") return "quota or rate limit";
  if (retryReason === "model_unavailable") return "model availability";
  if (retryReason === "transient") return "a temporary provider or network error";
  return "an unknown Gemini error";
}

function formatProviderErrorDetail(error) {
  const parts = [];
  if (error?.status) parts.push(`HTTP ${error.status}`);
  if (error?.code) parts.push(String(error.code));
  if (error?.message) parts.push(String(error.message));
  if (!parts.length && error) parts.push(String(error));
  if (!parts.length) return "No provider detail was returned.";
  return truncateMessage(parts.join(" - "), 520);
}

function truncateMessage(message, limit) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAiJson(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;

  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    extractJsonBlock(raw),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate shape.
    }
  }

  return { ...fallback, raw_text: raw.slice(0, 4000) };
}

function extractJsonBlock(text) {
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1);
  return "";
}

function pickAiModelSummary(response) {
  return {
    provider: response.provider,
    model: response.model,
    task: response.task,
    usage: response.usage || null,
  };
}

function uniqueTruthy(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export const __productPulseAiTestHooks = {
  buildWatchChangeReportNarrativePayload,
  buildWatchChangeReportNarrativePrompt,
};
