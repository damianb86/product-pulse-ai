import { z } from "zod";
import { AiToolExecutionError } from "../domain/errors";
import type {
  AnyAiToolDefinition,
  AiAnalyticsSnapshot,
  AiEvidenceSnippet,
  AiFinancialExposureBreakdown,
  AiProductRiskDetail,
  AiProductRiskSummary,
  AiProductPurchaseContextRiskImpact,
  AiProductPurchaseContextSummary,
  AiProductRelationshipInsights,
  AiProductRelationshipRiskImpact,
  AiProductRelationshipSummary,
  AiReturnRefundRelationshipSummary,
  AiReturnRefundResolutionSummary,
  AiToolDefinition,
  AiWatchlistSnapshot,
} from "../domain/types";
import {
  AI_DEFAULT_EVIDENCE_LIMIT,
  AI_DEFAULT_LIMIT,
  AI_MAX_EVIDENCE_LIMIT,
  AI_MAX_LIMIT,
  ProductPulseAiRepository,
  ProductPulseAnalyticsAiRepository,
  ProductPulseWatchlistAiRepository,
  normalizeLimit,
  normalizeOffset,
} from "../repositories/productPulseAiRepository.server";

export const PRODUCT_PULSE_AI_TOOL_NAMES = {
  listProductRiskSummaries: "product_pulse_list_product_risk_summaries",
  getProductRiskDetail: "product_pulse_get_product_risk_detail",
  getProductEvidenceSnippets: "product_pulse_get_product_evidence_snippets",
  getReturnRefundRelationshipSummary: "product_pulse_get_return_refund_relationship_summary",
  getProductReturnRefundResolution: "product_pulse_get_product_return_refund_resolution",
  getProductFinancialExposureBreakdown: "product_pulse_get_product_financial_exposure_breakdown",
  getProductPurchaseContextSummary: "product_pulse_get_product_purchase_context_summary",
  getProductBasketBehavior: "product_pulse_get_product_basket_behavior",
  getProductQuantityDistribution: "product_pulse_get_product_quantity_distribution",
  getProductCoPurchaseSummary: "product_pulse_get_product_co_purchase_summary",
  getProductPurchaseContextRiskImpact: "product_pulse_get_product_purchase_context_risk_impact",
  getProductRelationshipSummary: "product_pulse_get_product_relationship_summary",
  getProductBoughtTogetherRelationships: "product_pulse_get_product_bought_together_relationships",
  getProductPreviousPurchaseRelationships: "product_pulse_get_product_previous_purchase_relationships",
  getProductNextPurchaseRelationships: "product_pulse_get_product_next_purchase_relationships",
  getProductRelationshipRiskImpact: "product_pulse_get_product_relationship_risk_impact",
  getProductRelationshipInsights: "product_pulse_get_product_relationship_insights",
  getStoreAnalyticsSnapshot: "product_pulse_get_store_analytics_snapshot",
  getWatchlistSnapshot: "product_pulse_get_watchlist_snapshot",
} as const;

export interface ProductPulseAiToolDependencies {
  productRepository?: ProductPulseAiRepository;
  analyticsRepository?: ProductPulseAnalyticsAiRepository;
  watchlistRepository?: ProductPulseWatchlistAiRepository;
}

const limitSchema = z.coerce.number().int().optional().describe("Maximum number of results. Values above the hard cap are normalized.");

const listProductRiskSummariesInputSchema = z.object({
  query: z.string().trim().max(120).optional().describe("Optional product title, handle, or issue search text."),
  risk: z.enum(["all", "high", "medium", "low"]).optional().default("all").describe("Optional risk filter."),
  includeResolved: z.boolean().optional().default(false).describe("Include products the merchant marked as resolved. Leave false unless the user explicitly asks about resolved products."),
  limit: limitSchema,
  offset: z.coerce.number().int().optional().describe("Zero-based pagination offset."),
  sortBy: z.enum(["riskScore", "updatedAt", "confidence"]).optional().default("riskScore"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
});

const productRefInputSchema = z.object({
  productRef: z.string().trim().min(1).max(320).describe("Stored product GID or product handle. Tenant context is server-derived."),
});

const getProductRiskDetailInputSchema = productRefInputSchema.extend({
  evidenceLimit: limitSchema,
  issueLimit: limitSchema,
  recommendationLimit: limitSchema,
  actionLimit: limitSchema,
  historyLimit: limitSchema,
});

const getProductEvidenceInputSchema = productRefInputSchema.extend({
  limit: limitSchema,
});

const emptyInputSchema = z.object({});

const watchlistInputSchema = z.object({
  limit: limitSchema,
  activityLimit: limitSchema,
});

type ListProductRiskSummariesInput = z.infer<typeof listProductRiskSummariesInputSchema>;
type ProductRiskDetailInput = z.infer<typeof getProductRiskDetailInputSchema>;
type ProductEvidenceInput = z.infer<typeof getProductEvidenceInputSchema>;
type EmptyInput = z.infer<typeof emptyInputSchema>;
type WatchlistInput = z.infer<typeof watchlistInputSchema>;
type ProductRiskListData = {
  products: AiProductRiskSummary[];
  totalCount: number;
  resolvedProductsExcluded: boolean;
  excludedResolvedCount: number;
  notice?: string;
};
type ProductRiskDetailData = { product: AiProductRiskDetail };
type RelationshipSummaryData = { product: AiProductRiskSummary; relationship: AiReturnRefundRelationshipSummary };
type ReturnRefundResolutionData = { resolution: AiReturnRefundResolutionSummary };
type FinancialExposureBreakdownData = { product: AiProductRiskSummary; financialExposure: AiFinancialExposureBreakdown };
type PurchaseContextSummaryData = { purchaseContext: AiProductPurchaseContextSummary };
type PurchaseContextRiskImpactData = { product: AiProductRiskSummary; purchaseContextRiskImpact: AiProductPurchaseContextRiskImpact };
type ProductRelationshipSummaryData = { productRelationship: AiProductRelationshipSummary };
type ProductRelationshipRiskImpactData = { product: AiProductRiskSummary; relationshipRiskImpact: AiProductRelationshipRiskImpact };
type ProductRelationshipInsightsData = { product: AiProductRiskSummary; relationshipInsights: AiProductRelationshipInsights };
type StoreAnalyticsData = { analytics: AiAnalyticsSnapshot };
type WatchlistData = { watchlist: AiWatchlistSnapshot };

export function createProductPulseAiToolDefinitions(
  dependencies: ProductPulseAiToolDependencies = {},
): AnyAiToolDefinition[] {
  const productRepository = dependencies.productRepository || new ProductPulseAiRepository();
  const analyticsRepository = dependencies.analyticsRepository || new ProductPulseAnalyticsAiRepository();
  const watchlistRepository = dependencies.watchlistRepository || new ProductPulseWatchlistAiRepository();

  const listProductRiskSummariesTool: AiToolDefinition<ListProductRiskSummariesInput, ProductRiskListData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
      description: "List compact ProductPulse product risk summaries for the authenticated shop. Resolved products are excluded by default unless includeResolved is true.",
      inputSchema: listProductRiskSummariesInputSchema,
      readOnly: true,
      category: "products",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRiskSummary[]",
        dataSources: ["ProductRiskSnapshot", "ProductDiagnosis", "ProductWatchlistItem"],
        maxResultCount: AI_MAX_LIMIT,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const limit = normalizeLimit(input.limit, AI_DEFAULT_LIMIT, AI_MAX_LIMIT);
        const offset = normalizeOffset(input.offset);
        const result = await productRepository.listProductRiskSummaries(context, {
          ...input,
          limit,
          offset,
        });
        return {
          data: {
            products: result.products,
            totalCount: result.totalCount,
            resolvedProductsExcluded: result.resolvedProductsExcluded,
            excludedResolvedCount: result.excludedResolvedCount,
            notice: result.resolvedProductsExcluded
              ? "Products marked as resolved were excluded from this general search/list result."
              : undefined,
          },
          metadata: {
            resultCount: result.products.length,
            limit,
            offset,
            hasMore: result.hasMore,
            dataFreshness: result.freshness,
            resolvedProductsExcluded: result.resolvedProductsExcluded,
            excludedResolvedCount: result.excludedResolvedCount,
          },
        };
      },
    };

  const getProductRiskDetailTool: AiToolDefinition<ProductRiskDetailInput, ProductRiskDetailData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      description: "Get a compact read-only product risk, diagnosis, evidence, action-history, and trend detail for one stored ProductPulse product.",
      inputSchema: getProductRiskDetailInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRiskDetail",
        dataSources: ["ProductRiskSnapshot", "ProductDiagnosis", "ProductAction", "ProductScoreHistory", "ProductWatchlistItem"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const detail = await productRepository.getProductRiskDetail(context, input.productRef, {
          evidenceLimit: normalizeLimit(input.evidenceLimit, AI_DEFAULT_EVIDENCE_LIMIT, AI_MAX_EVIDENCE_LIMIT),
          issueLimit: normalizeLimit(input.issueLimit, 5, 10),
          recommendationLimit: normalizeLimit(input.recommendationLimit, 5, 10),
          actionLimit: normalizeLimit(input.actionLimit, 8, 20),
          historyLimit: normalizeLimit(input.historyLimit, 8, 20),
        });
        if (!detail) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { product: detail },
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: detail.updatedAt || detail.calculatedAt }],
          },
        };
      },
    };

  const getProductEvidenceSnippetsTool: AiToolDefinition<ProductEvidenceInput, { product: AiProductRiskSummary; evidence: AiEvidenceSnippet[] }> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductEvidenceSnippets,
      description: "Get bounded evidence snippets behind one stored ProductPulse Product Diagnosis.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "evidence",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiEvidenceSnippet[]",
        dataSources: ["ProductDiagnosis", "ProductRiskSnapshot"],
        maxResultCount: AI_MAX_EVIDENCE_LIMIT,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const limit = normalizeLimit(input.limit, AI_DEFAULT_EVIDENCE_LIMIT, AI_MAX_EVIDENCE_LIMIT);
        const result = await productRepository.getProductEvidenceSnippets(context, input.productRef, { limit });
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have evidence for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: result.evidence.length,
            limit,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getReturnRefundRelationshipSummaryTool: AiToolDefinition<ProductEvidenceInput, RelationshipSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getReturnRefundRelationshipSummary,
      description: "Get a compact read-only return/refund relationship summary for one stored ProductPulse product, including linked returns, return-only, refund-only and attribution confidence.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiReturnRefundRelationshipSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const result = await productRepository.getReturnRefundRelationshipSummary(context, input.productRef);
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getProductReturnRefundResolutionTool: AiToolDefinition<ProductEvidenceInput, ReturnRefundResolutionData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductReturnRefundResolution,
      description: "Get the compact return/refund resolution matrix for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiReturnRefundResolutionSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const resolution = await productRepository.getProductReturnRefundResolution(context, input.productRef);
        if (!resolution) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { resolution },
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: null }],
          },
        };
      },
    };

  const getProductFinancialExposureBreakdownTool: AiToolDefinition<ProductEvidenceInput, FinancialExposureBreakdownData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductFinancialExposureBreakdown,
      description: "Get a compact read-only estimated margin exposure breakdown separating confirmed refunds, return-related risk, unattributed refunds, and attribution confidence.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiFinancialExposureBreakdown",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const result = await productRepository.getProductFinancialExposureBreakdown(context, input.productRef);
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getProductPurchaseContextSummaryTool: AiToolDefinition<ProductEvidenceInput, PurchaseContextSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductPurchaseContextSummary,
      description: "Get compact read-only purchase context for one stored ProductPulse product, including solo/basket behavior, quantity, variants, co-purchases and confidence.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductPurchaseContextSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const purchaseContext = await productRepository.getProductPurchaseContextSummary(context, input.productRef);
        if (!purchaseContext) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { purchaseContext },
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: null }],
          },
        };
      },
    };

  const getProductBasketBehaviorTool: AiToolDefinition<ProductEvidenceInput, PurchaseContextSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductBasketBehavior,
      description: "Get compact solo-versus-basket purchase behavior for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductPurchaseContextSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const purchaseContext = await productRepository.getProductBasketBehavior(context, input.productRef);
        if (!purchaseContext) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { purchaseContext },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductQuantityDistributionTool: AiToolDefinition<ProductEvidenceInput, PurchaseContextSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductQuantityDistribution,
      description: "Get compact quantity distribution for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductPurchaseContextSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const purchaseContext = await productRepository.getProductQuantityDistribution(context, input.productRef);
        if (!purchaseContext) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { purchaseContext },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductCoPurchaseSummaryTool: AiToolDefinition<ProductEvidenceInput, PurchaseContextSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductCoPurchaseSummary,
      description: "Get compact co-purchase products and affinity for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductPurchaseContextSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const purchaseContext = await productRepository.getProductCoPurchaseSummary(context, input.productRef);
        if (!purchaseContext) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { purchaseContext },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductPurchaseContextRiskImpactTool: AiToolDefinition<ProductEvidenceInput, PurchaseContextRiskImpactData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductPurchaseContextRiskImpact,
      description: "Get compact read-only purchase-context impact on Product Risk, Diagnosis Confidence and related metrics for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductPurchaseContextRiskImpact",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const result = await productRepository.getProductPurchaseContextRiskImpact(context, input.productRef);
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getProductRelationshipSummaryTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRelationshipSummary,
      description: "Get compact read-only Product Relationship Intelligence for one stored ProductPulse product, including bought-together, before, after, risk-impact and opportunity relationships.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const productRelationship = await productRepository.getProductRelationshipSummary(context, input.productRef);
        if (!productRelationship) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { productRelationship },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductBoughtTogetherRelationshipsTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductBoughtTogetherRelationships,
      description: "Get compact read-only same-order product relationships for one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const productRelationship = await productRepository.getProductBoughtTogetherRelationships(context, input.productRef);
        if (!productRelationship) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { productRelationship },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductPreviousPurchaseRelationshipsTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductPreviousPurchaseRelationships,
      description: "Get compact read-only products commonly bought before one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const productRelationship = await productRepository.getProductPreviousPurchaseRelationships(context, input.productRef);
        if (!productRelationship) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { productRelationship },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductNextPurchaseRelationshipsTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipSummaryData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductNextPurchaseRelationships,
      description: "Get compact read-only products commonly bought after one stored ProductPulse product.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipSummary",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const productRelationship = await productRepository.getProductNextPurchaseRelationships(context, input.productRef);
        if (!productRelationship) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: { productRelationship },
          metadata: { resultCount: 1, dataFreshness: [{ source: "ProductPulse", updatedAt: null }] },
        };
      },
    };

  const getProductRelationshipRiskImpactTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipRiskImpactData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRelationshipRiskImpact,
      description: "Get compact read-only Product Relationship Intelligence impact on Product Risk context, Diagnosis Confidence, and relationship-based opportunities.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipRiskImpact",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const result = await productRepository.getProductRelationshipRiskImpact(context, input.productRef);
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: 1,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getProductRelationshipInsightsTool: AiToolDefinition<ProductEvidenceInput, ProductRelationshipInsightsData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRelationshipInsights,
      description: "Get compact read-only AI-written product relationship insights generated from sanitized deterministic relationship metrics.",
      inputSchema: getProductEvidenceInputSchema,
      readOnly: true,
      category: "diagnosis",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiProductRelationshipInsights",
        dataSources: ["ProductRiskSnapshot"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const result = await productRepository.getProductRelationshipInsights(context, input.productRef);
        if (!result) {
          throw new AiToolExecutionError("NOT_FOUND", "ProductPulse does not have a stored product risk record for that product reference.");
        }
        return {
          data: result,
          metadata: {
            resultCount: result.relationshipInsights.insights.length,
            dataFreshness: [{ source: "ProductPulse", updatedAt: result.product.updatedAt || result.product.calculatedAt }],
          },
        };
      },
    };

  const getStoreAnalyticsSnapshotTool: AiToolDefinition<EmptyInput, StoreAnalyticsData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getStoreAnalyticsSnapshot,
      description: "Get compact store-level ProductPulse analytics for the authenticated shop.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      category: "analytics",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiAnalyticsSnapshot",
        dataSources: ["ProductRiskSnapshot", "ProductPulseSource", "ProductDiagnosis", "ProductAction"],
        maxResultCount: 1,
        providerAgnostic: true,
      },
      async execute(context) {
        const analytics = await analyticsRepository.getAnalyticsSnapshot(context);
        const { freshness, ...snapshot } = analytics;
        return {
          data: { analytics: snapshot },
          metadata: {
            resultCount: 1,
            dataFreshness: freshness,
            warnings: analytics.sampled ? [`Analytics are based on the first ${analytics.sampledProductCount} stored products.`] : [],
          },
        };
      },
    };

  const getWatchlistSnapshotTool: AiToolDefinition<WatchlistInput, WatchlistData> = {
      name: PRODUCT_PULSE_AI_TOOL_NAMES.getWatchlistSnapshot,
      description: "Get current ProductPulse watchlist status and recent safe watch activity for the authenticated shop.",
      inputSchema: watchlistInputSchema,
      readOnly: true,
      category: "watchlist",
      permissionLevel: "merchant",
      metadata: {
        resultType: "AiWatchlistSnapshot",
        dataSources: ["ProductWatchlistItem", "ProductRiskSnapshot", "ProductWatchSettings", "ProductWatchActivity"],
        maxResultCount: AI_MAX_LIMIT,
        providerAgnostic: true,
      },
      async execute(context, input) {
        const watchlist = await watchlistRepository.getWatchlistSnapshot(context, {
          limit: normalizeLimit(input.limit, 5, AI_MAX_LIMIT),
          activityLimit: normalizeLimit(input.activityLimit, 5, AI_MAX_LIMIT),
        });
        const { freshness, ...snapshot } = watchlist;
        return {
          data: { watchlist: snapshot },
          metadata: {
            resultCount: snapshot.items.length,
            limit: normalizeLimit(input.limit, 5, AI_MAX_LIMIT),
            dataFreshness: freshness,
          },
        };
      },
    };

  return [
    listProductRiskSummariesTool,
    getProductRiskDetailTool,
    getProductEvidenceSnippetsTool,
    getReturnRefundRelationshipSummaryTool,
    getProductReturnRefundResolutionTool,
    getProductFinancialExposureBreakdownTool,
    getProductPurchaseContextSummaryTool,
    getProductBasketBehaviorTool,
    getProductQuantityDistributionTool,
    getProductCoPurchaseSummaryTool,
    getProductPurchaseContextRiskImpactTool,
    getProductRelationshipSummaryTool,
    getProductBoughtTogetherRelationshipsTool,
    getProductPreviousPurchaseRelationshipsTool,
    getProductNextPurchaseRelationshipsTool,
    getProductRelationshipRiskImpactTool,
    getProductRelationshipInsightsTool,
    getStoreAnalyticsSnapshotTool,
    getWatchlistSnapshotTool,
  ] as unknown as AnyAiToolDefinition[];
}
