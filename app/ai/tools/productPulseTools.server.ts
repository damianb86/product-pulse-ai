import { z } from "zod";
import { AiToolExecutionError } from "../domain/errors";
import type {
  AnyAiToolDefinition,
  AiAnalyticsSnapshot,
  AiEvidenceSnippet,
  AiProductRiskDetail,
  AiProductRiskSummary,
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
type ProductRiskListData = { products: AiProductRiskSummary[]; totalCount: number };
type ProductRiskDetailData = { product: AiProductRiskDetail };
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
      description: "List compact ProductPulse product risk summaries for the authenticated shop.",
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
          },
          metadata: {
            resultCount: result.products.length,
            limit,
            offset,
            hasMore: result.hasMore,
            dataFreshness: result.freshness,
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
      description: "Get bounded evidence snippets behind one stored ProductPulse product analysis.",
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
    getStoreAnalyticsSnapshotTool,
    getWatchlistSnapshotTool,
  ] as unknown as AnyAiToolDefinition[];
}
