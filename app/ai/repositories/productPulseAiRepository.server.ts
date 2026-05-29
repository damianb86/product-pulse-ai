import type { PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type {
  AiActionHistorySummary,
  AiAnalyticsSnapshot,
  AiDataFreshness,
  AiDiagnosisSummary,
  AiEvidenceSnippet,
  AiIssueSummary,
  AiProductMetricSummary,
  AiProductPurchaseContextRiskImpact,
  AiProductPurchaseContextSummary,
  AiProductRelationshipInsights,
  AiProductRelationshipItem,
  AiProductRelationshipRiskImpact,
  AiProductRelationshipSummary,
  AiProductRiskDetail,
  AiProductRiskSummary,
  AiFinancialExposureBreakdown,
  AiRecentActivityItem,
  AiRecommendationSummary,
  AiReturnRefundRelationshipSummary,
  AiReturnRefundResolutionSummary,
  AiSourceSummary,
  AiToolContext,
  AiWatchlistItemSummary,
  AiWatchlistSnapshot,
} from "../domain/types";
import { filterDisabledProductActions } from "../../lib/product-pulse-disabled-actions";

type AiPrismaClient = Pick<
  PrismaClient,
  | "productRiskSnapshot"
  | "productDiagnosis"
  | "productAction"
  | "productPulseSource"
  | "productWatchlistItem"
  | "productWatchSettings"
  | "productWatchActivity"
  | "productScoreHistory"
>;

type DbRecord = Record<string, unknown>;
interface WatchSettingsInput {
  scanCadenceDays: number;
  alertRecipients: string[];
  triggerRule: string;
  summarySchedule: string;
  alertsEnabled: boolean;
}

export const AI_DEFAULT_LIMIT = 10;
export const AI_MAX_LIMIT = 25;
export const AI_DEFAULT_EVIDENCE_LIMIT = 5;
export const AI_MAX_EVIDENCE_LIMIT = 12;

const SETTINGS_SOURCE_KEY = "__productpulse_settings";
const ANALYTICS_SAMPLE_LIMIT = 1000;
const WATCHLIST_MAX_PRODUCTS = 99;
const DEFAULT_RISK_SETTINGS = {
  minimumScore: 18,
  mediumThreshold: 55,
  highThreshold: 75,
};
const DEFAULT_WATCH_SETTINGS: WatchSettingsInput = {
  scanCadenceDays: 3,
  alertRecipients: [],
  triggerRule: "new_or_rising_risk",
  summarySchedule: "daily_digest_8am",
  alertsEnabled: true,
};

export interface ListProductRiskSummariesOptions {
  query?: string;
  risk?: "all" | "high" | "medium" | "low";
  limit?: number;
  offset?: number;
  sortBy?: "riskScore" | "updatedAt" | "confidence";
  sortDirection?: "asc" | "desc";
  includeResolved?: boolean;
}

export interface ProductDetailOptions {
  evidenceLimit?: number;
  issueLimit?: number;
  recommendationLimit?: number;
  actionLimit?: number;
  historyLimit?: number;
}

export interface WatchlistSnapshotOptions {
  limit?: number;
  activityLimit?: number;
}

export class ProductPulseAiRepository {
  protected db: AiPrismaClient;

  constructor(db: AiPrismaClient = prisma as unknown as AiPrismaClient) {
    this.db = db;
  }

  async listProductRiskSummaries(
    context: AiToolContext,
    options: ListProductRiskSummariesOptions = {},
  ): Promise<{
    products: AiProductRiskSummary[];
    totalCount: number;
    hasMore: boolean;
    freshness: AiDataFreshness[];
    resolvedProductsExcluded: boolean;
    excludedResolvedCount: number;
  }> {
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const settings = await this.getRiskSettings(context);
    const baseWhere = buildProductSnapshotWhere(context.shop, options.query, options.risk, settings);
    const includeResolved = options.includeResolved === true;
    const resolvedProductGids = includeResolved ? [] : await this.getResolvedProductGids(context);
    const where = includeResolved
      ? baseWhere
      : buildProductSnapshotWhereWithResolvedFilter(baseWhere, resolvedProductGids, "notIn");
    const resolvedWhere = !includeResolved && resolvedProductGids.length
      ? buildProductSnapshotWhereWithResolvedFilter(baseWhere, resolvedProductGids, "in")
      : null;
    const orderBy = buildProductSnapshotOrderBy(options.sortBy, options.sortDirection);
    const fetchTake = Math.min(Math.max(limit * 2, limit + 1), 75);

    const [snapshots, totalCount, excludedResolvedCount] = await Promise.all([
      this.db.productRiskSnapshot.findMany({
        where,
        orderBy,
        skip: offset,
        take: fetchTake,
      }),
      safeCount(() => this.db.productRiskSnapshot.count({ where })),
      resolvedWhere ? safeCount(() => this.db.productRiskSnapshot.count({ where: resolvedWhere })) : Promise.resolve(0),
    ]);

    const snapshotRows = (snapshots as unknown as DbRecord[])
      .filter((snapshot) => includeResolved || !resolvedProductGids.includes(String(snapshot.productGid || "")));
    const productGids = uniqueStrings(snapshotRows.map((snapshot) => snapshot.productGid));
    const [latestDiagnoses, watchedItems] = await Promise.all([
      this.getLatestCompletedDiagnoses(context, productGids),
      productGids.length
        ? this.db.productWatchlistItem.findMany({
            where: { shop: context.shop, productGid: { in: productGids } },
            select: { productGid: true, status: true },
          })
        : Promise.resolve([]),
    ]);
    const watchedByProductGid = new Map(
      (watchedItems as Array<{ productGid: string; status: string }>).map((item) => [item.productGid, item]),
    );

    const products = snapshotRows
      .map((snapshot) => mapProductSummary({
        snapshot,
        settings,
        latestDiagnosis: latestDiagnoses.get(String(snapshot.productGid || "")) || null,
        watchedItem: watchedByProductGid.get(String(snapshot.productGid || "")) || null,
      }))
      .slice(0, limit);

    const resolvedTotalCount = totalCount ?? Math.max(offset + products.length, snapshotRows.length);

    return {
      products,
      totalCount: resolvedTotalCount,
      hasMore: snapshotRows.length > limit || offset + products.length < resolvedTotalCount,
      freshness: buildFreshness(products.map((product) => product.updatedAt || product.calculatedAt)),
      resolvedProductsExcluded: !includeResolved,
      excludedResolvedCount: excludedResolvedCount ?? 0,
    };
  }

  private async getResolvedProductGids(context: AiToolContext): Promise<string[]> {
    const actions = await this.db.productAction.findMany({
      where: {
        shop: context.shop,
        actionType: { in: ["mark-resolved", "mark-unresolved"] },
        status: "applied",
      },
      orderBy: [
        { productGid: "asc" },
        { appliedAt: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        productGid: true,
        actionType: true,
      },
    });

    const latestResolvedByProductGid = new Map<string, boolean>();
    for (const action of actions as Array<{ productGid?: string | null; actionType?: string | null }>) {
      const productGid = optionalText(action.productGid);
      if (!productGid || latestResolvedByProductGid.has(productGid)) continue;
      latestResolvedByProductGid.set(productGid, action.actionType === "mark-resolved");
    }
    return [...latestResolvedByProductGid.entries()]
      .filter(([, isResolved]) => isResolved)
      .map(([productGid]) => productGid);
  }

  async getProductRiskDetail(
    context: AiToolContext,
    productRef: string,
    options: ProductDetailOptions = {},
  ): Promise<AiProductRiskDetail | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const productGid = String(snapshot.productGid || "");

    const settings = await this.getRiskSettings(context);
    const [latestDiagnosis, actions, watchlistItem, riskHistory] = await Promise.all([
      this.db.productDiagnosis.findFirst({
        where: { shop: context.shop, productGid, status: "Completed" },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      }),
      this.db.productAction.findMany({
        where: { shop: context.shop, productGid },
        orderBy: [{ createdAt: "desc" }],
        take: normalizeLimit(options.actionLimit, 8, 20),
      }),
      this.db.productWatchlistItem.findUnique({
        where: { shop_productGid: { shop: context.shop, productGid } },
        select: { productGid: true, status: true },
      }),
      this.db.productScoreHistory.findMany({
        where: { shop: context.shop, productGid },
        orderBy: { recordedAt: "desc" },
        take: normalizeLimit(options.historyLimit, 8, 20),
      }),
    ]);

    const summary = mapProductSummary({ snapshot, settings, latestDiagnosis, watchedItem: watchlistItem });
    return {
      ...summary,
      diagnosis: latestDiagnosis
        ? mapDiagnosisSummary(latestDiagnosis, productGid, {
            evidenceLimit: normalizeLimit(options.evidenceLimit, AI_DEFAULT_EVIDENCE_LIMIT, AI_MAX_EVIDENCE_LIMIT),
            issueLimit: normalizeLimit(options.issueLimit, 5, 10),
            recommendationLimit: normalizeLimit(options.recommendationLimit, 5, 10),
          })
        : null,
      actionHistory: (filterDisabledProductActions(actions as unknown as DbRecord[]) as DbRecord[]).map(mapActionHistorySummary),
      riskHistory: (riskHistory as unknown as DbRecord[])
        .reverse()
        .map((row) => ({
          riskScore: toInteger(row.riskScore, 0),
          impactScore: toNullableNumber(row.impactScore),
          confidence: toNullableNumber(row.confidence),
          source: optionalText(row.source) || "unknown",
          primaryIssue: optionalText(row.primaryIssue),
          recordedAt: toIso(row.recordedAt),
        })),
      mainFinding: mapMainFinding(snapshot.metrics),
    };
  }

  async getProductEvidenceSnippets(
    context: AiToolContext,
    productRef: string,
    options: { limit?: number } = {},
  ): Promise<{ product: AiProductRiskSummary; evidence: AiEvidenceSnippet[] } | null> {
    const detail = await this.getProductRiskDetail(context, productRef, {
      evidenceLimit: normalizeLimit(options.limit, AI_DEFAULT_EVIDENCE_LIMIT, AI_MAX_EVIDENCE_LIMIT),
      issueLimit: 0,
      recommendationLimit: 0,
      actionLimit: 0,
      historyLimit: 0,
    });
    if (!detail) return null;

    const evidence = detail.diagnosis?.evidence?.length
      ? detail.diagnosis.evidence
      : buildSnapshotEvidence(detail);

    return {
      product: stripProductDetail(detail),
      evidence: evidence.slice(0, normalizeLimit(options.limit, AI_DEFAULT_EVIDENCE_LIMIT, AI_MAX_EVIDENCE_LIMIT)),
    };
  }

  async getReturnRefundRelationshipSummary(
    context: AiToolContext,
    productRef: string,
  ): Promise<{ product: AiProductRiskSummary; relationship: AiReturnRefundRelationshipSummary } | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const settings = await this.getRiskSettings(context);
    const product = mapProductSummary({ snapshot, settings });
    return {
      product,
      relationship: product.metrics.returnRefundRelationship
        || buildAiReturnRefundRelationshipSummary(asRecord(snapshot.metrics))
        || buildUnavailableAiReturnRefundRelationshipSummary(),
    };
  }

  async getProductReturnRefundResolution(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiReturnRefundResolutionSummary | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    return buildAiReturnRefundResolution(snapshot);
  }

  async getProductFinancialExposureBreakdown(
    context: AiToolContext,
    productRef: string,
  ): Promise<{ product: AiProductRiskSummary; financialExposure: AiFinancialExposureBreakdown } | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const settings = await this.getRiskSettings(context);
    const product = mapProductSummary({ snapshot, settings });
    return {
      product,
      financialExposure: product.metrics.financialExposureBreakdown || buildAiFinancialExposureBreakdown(asRecord(snapshot.metrics)),
    };
  }

  async getProductPurchaseContextSummary(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductPurchaseContextSummary | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    return buildAiProductPurchaseContextSummary(snapshot);
  }

  async getProductBasketBehavior(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductPurchaseContextSummary | null> {
    return this.getProductPurchaseContextSummary(context, productRef);
  }

  async getProductQuantityDistribution(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductPurchaseContextSummary | null> {
    return this.getProductPurchaseContextSummary(context, productRef);
  }

  async getProductCoPurchaseSummary(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductPurchaseContextSummary | null> {
    return this.getProductPurchaseContextSummary(context, productRef);
  }

  async getProductPurchaseContextRiskImpact(
    context: AiToolContext,
    productRef: string,
  ): Promise<{ product: AiProductRiskSummary; purchaseContextRiskImpact: AiProductPurchaseContextRiskImpact } | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const settings = await this.getRiskSettings(context);
    const product = mapProductSummary({ snapshot, settings });
    return {
      product,
      purchaseContextRiskImpact: buildAiProductPurchaseContextRiskImpact(asRecord(snapshot.metrics)),
    };
  }

  async getProductRelationshipSummary(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductRelationshipSummary | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    return buildAiProductRelationshipSummary(snapshot);
  }

  async getProductBoughtTogetherRelationships(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductRelationshipSummary | null> {
    return this.getProductRelationshipSummary(context, productRef);
  }

  async getProductPreviousPurchaseRelationships(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductRelationshipSummary | null> {
    return this.getProductRelationshipSummary(context, productRef);
  }

  async getProductNextPurchaseRelationships(
    context: AiToolContext,
    productRef: string,
  ): Promise<AiProductRelationshipSummary | null> {
    return this.getProductRelationshipSummary(context, productRef);
  }

  async getProductRelationshipRiskImpact(
    context: AiToolContext,
    productRef: string,
  ): Promise<{ product: AiProductRiskSummary; relationshipRiskImpact: AiProductRelationshipRiskImpact } | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const settings = await this.getRiskSettings(context);
    const product = mapProductSummary({ snapshot, settings });
    return {
      product,
      relationshipRiskImpact: buildAiProductRelationshipRiskImpact(asRecord(snapshot.metrics)),
    };
  }

  async getProductRelationshipInsights(
    context: AiToolContext,
    productRef: string,
  ): Promise<{ product: AiProductRiskSummary; relationshipInsights: AiProductRelationshipInsights } | null> {
    const snapshot = await this.findSnapshotByProductRef(context, productRef);
    if (!snapshot) return null;
    const settings = await this.getRiskSettings(context);
    const product = mapProductSummary({ snapshot, settings });
    return {
      product,
      relationshipInsights: buildAiProductRelationshipInsights(asRecord(snapshot.metrics)),
    };
  }

  protected async findSnapshotByProductRef(context: AiToolContext, productRef: string): Promise<DbRecord | null> {
    const normalized = normalizeProductRef(productRef);
    if (!normalized) return null;
    const where = normalized.startsWith("gid://")
      ? { shop: context.shop, productGid: normalized }
      : {
          shop: context.shop,
          OR: [
            { productGid: normalized },
            { handle: normalized },
          ],
        };

    return this.db.productRiskSnapshot.findFirst({ where });
  }

  protected async getRiskSettings(context: AiToolContext): Promise<typeof DEFAULT_RISK_SETTINGS> {
    const settings = await this.db.productPulseSource.findUnique({
      where: { shop_sourceKey: { shop: context.shop, sourceKey: SETTINGS_SOURCE_KEY } },
      select: { config: true },
    }).catch(() => null);
    return normalizeRiskSettings(settings?.config);
  }

  protected async getLatestCompletedDiagnoses(
    context: AiToolContext,
    productGids: string[],
  ): Promise<Map<string, DbRecord>> {
    if (!productGids.length) return new Map();
    const rows = await this.db.productDiagnosis.findMany({
      where: {
        shop: context.shop,
        productGid: { in: productGids },
        status: "Completed",
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: productGids.length * 4,
    });
    const byProductGid = new Map<string, DbRecord>();
    (rows as unknown as DbRecord[]).forEach((row) => {
      const productGid = String(row.productGid || "");
      if (productGid && !byProductGid.has(productGid)) byProductGid.set(productGid, row);
    });
    return byProductGid;
  }
}

export class ProductPulseAnalyticsAiRepository extends ProductPulseAiRepository {
  async getAnalyticsSnapshot(context: AiToolContext): Promise<AiAnalyticsSnapshot & { freshness: AiDataFreshness[] }> {
    const settings = await this.getRiskSettings(context);
    const where = { shop: context.shop };
    const [snapshots, productCount, sources, recentDiagnosisCount, openRecommendationCount, appliedActionCount] = await Promise.all([
      this.db.productRiskSnapshot.findMany({
        where,
        orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
        take: ANALYTICS_SAMPLE_LIMIT,
      }),
      safeCount(() => this.db.productRiskSnapshot.count({ where })),
      this.db.productPulseSource.findMany({
        where: { shop: context.shop, sourceKey: { not: SETTINGS_SOURCE_KEY } },
        orderBy: [{ category: "asc" }, { sourceKey: "asc" }],
      }),
      safeCount(() => this.db.productDiagnosis.count({
        where: {
          shop: context.shop,
          status: "Completed",
          completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      })),
      safeCount(() => this.db.productAction.count({
        where: { shop: context.shop, status: { in: ["draft", "active", "reviewed"] } },
      })),
      safeCount(() => this.db.productAction.count({
        where: { shop: context.shop, status: "applied" },
      })),
    ]);

    const products = snapshots as unknown as DbRecord[];
    const resolvedProductCount = productCount ?? products.length;
    const riskDistribution = { high: 0, medium: 0, low: 0 };
    const issueStats = new Map<string, { count: number; highestRiskScore: number }>();
    let riskTotal = 0;
    let confidenceTotal = 0;
    let confidenceCount = 0;

    products.forEach((snapshot) => {
      const riskScore = toInteger(snapshot.riskScore, 0);
      riskTotal += riskScore;
      const label = getRiskLabel(riskScore, settings).toLowerCase();
      if (label === "high") riskDistribution.high += 1;
      else if (label === "medium") riskDistribution.medium += 1;
      else riskDistribution.low += 1;

      const confidence = toNullableNumber(snapshot.confidence);
      if (confidence !== null) {
        confidenceTotal += confidence;
        confidenceCount += 1;
      }

      const issue = optionalText(snapshot.primaryIssue);
      if (issue) {
        const current = issueStats.get(issue) || { count: 0, highestRiskScore: 0 };
        current.count += 1;
        current.highestRiskScore = Math.max(current.highestRiskScore, riskScore);
        issueStats.set(issue, current);
      }
    });

    const sourceCoverage = (sources as unknown as DbRecord[]).map(mapSourceSummary);
    const freshness = buildFreshness([
      ...products.map((snapshot) => toIso(snapshot.updatedAt) || toIso(snapshot.calculatedAt)),
      ...sourceCoverage.map((source) => source.lastSyncedAt || source.connectedAt),
    ]);

    return {
      productCount: resolvedProductCount,
      sampledProductCount: products.length,
      sampled: resolvedProductCount > products.length,
      averageRiskScore: products.length ? round(riskTotal / products.length, 1) : null,
      averageConfidence: confidenceCount ? round(confidenceTotal / confidenceCount, 1) : null,
      riskDistribution,
      topIssues: Array.from(issueStats.entries())
        .map(([issue, stats]) => ({ issue, ...stats }))
        .sort((first, second) => second.count - first.count || second.highestRiskScore - first.highestRiskScore)
        .slice(0, 8),
      sourceCoverage,
      recentDiagnosisCount: recentDiagnosisCount ?? 0,
      openRecommendationCount: openRecommendationCount ?? 0,
      appliedActionCount: appliedActionCount ?? 0,
      freshness,
    };
  }
}

export class ProductPulseWatchlistAiRepository extends ProductPulseAiRepository {
  async getWatchlistSnapshot(
    context: AiToolContext,
    options: WatchlistSnapshotOptions = {},
  ): Promise<AiWatchlistSnapshot & { freshness: AiDataFreshness[] }> {
    const limit = normalizeLimit(options.limit, WATCHLIST_MAX_PRODUCTS, AI_MAX_LIMIT);
    const activityLimit = normalizeLimit(options.activityLimit, 5, AI_MAX_LIMIT);
    const [items, watchedCount, settingsRecord, activities] = await Promise.all([
      this.db.productWatchlistItem.findMany({
        where: { shop: context.shop },
        orderBy: { addedAt: "asc" },
        take: limit,
      }),
      safeCount(() => this.db.productWatchlistItem.count({ where: { shop: context.shop } })),
      this.db.productWatchSettings.findUnique({ where: { shop: context.shop } }).catch(() => null),
      this.db.productWatchActivity.findMany({
        where: { shop: context.shop, eventType: { not: "watch_order_changed" } },
        orderBy: { createdAt: "desc" },
        take: activityLimit,
      }),
    ]);

    const watchlistRows = items as unknown as DbRecord[];
    const productGids = uniqueStrings(watchlistRows.map((item) => item.productGid));
    const snapshots = productGids.length
      ? await this.db.productRiskSnapshot.findMany({
          where: { shop: context.shop, productGid: { in: productGids } },
        })
      : [];
    const snapshotRows = snapshots as unknown as DbRecord[];
    const snapshotByProductGid = new Map(snapshotRows.map((snapshot) => [String(snapshot.productGid || ""), snapshot]));
    const settings = normalizeWatchSettings(settingsRecord);
    const riskSettings = await this.getRiskSettings(context);
    const watchItems = watchlistRows.map((item) => mapWatchlistItemSummary(
      item,
      snapshotByProductGid.get(String(item.productGid || "")) || null,
      riskSettings,
    ));
    const recentActivity = (activities as unknown as DbRecord[]).map(mapRecentActivityItem);

    return {
      maxProducts: WATCHLIST_MAX_PRODUCTS,
      watchedCount: watchedCount ?? watchItems.length,
      slotsAvailable: Math.max(0, WATCHLIST_MAX_PRODUCTS - (watchedCount ?? watchItems.length)),
      alertsEnabled: settings.alertsEnabled,
      alertRecipientCount: settings.alertRecipientCount,
      scanCadenceDays: settings.scanCadenceDays,
      triggerRule: settings.triggerRule,
      summarySchedule: settings.summarySchedule,
      items: watchItems,
      recentActivity,
      freshness: buildFreshness([
        ...watchItems.map((item) => item.lastUpdatedAt || item.addedAt),
        ...recentActivity.map((activity) => activity.createdAt),
      ]),
    };
  }
}

export function normalizeLimit(value: unknown, fallback = AI_DEFAULT_LIMIT, max = AI_MAX_LIMIT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(parsed)));
}

export function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function buildProductSnapshotWhere(
  shop: string,
  rawQuery: string | undefined,
  risk: "all" | "high" | "medium" | "low" | undefined,
  settings: typeof DEFAULT_RISK_SETTINGS,
): Record<string, unknown> {
  const where: Record<string, unknown> = { shop };
  const query = String(rawQuery || "").trim();
  if (query.length >= 2) {
    where.OR = [
      { productTitle: { contains: query, mode: "insensitive" } },
      { handle: { contains: query, mode: "insensitive" } },
      { primaryIssue: { contains: query, mode: "insensitive" } },
    ];
  }

  if (risk === "high") {
    where.riskScore = { gte: settings.highThreshold };
  } else if (risk === "medium") {
    where.riskScore = { gte: settings.mediumThreshold, lt: settings.highThreshold };
  } else if (risk === "low") {
    where.riskScore = { lt: settings.mediumThreshold };
  }
  return where;
}

function buildProductSnapshotWhereWithResolvedFilter(
  where: Record<string, unknown>,
  productGids: string[],
  mode: "in" | "notIn",
): Record<string, unknown> {
  if (!productGids.length) return where;
  return {
    AND: [
      where,
      { productGid: { [mode]: productGids } },
    ],
  };
}

function buildProductSnapshotOrderBy(
  sortBy: ListProductRiskSummariesOptions["sortBy"] = "riskScore",
  sortDirection: ListProductRiskSummariesOptions["sortDirection"] = "desc",
): Array<Record<string, "asc" | "desc">> {
  const safeSortBy = ["riskScore", "updatedAt", "confidence"].includes(String(sortBy)) ? String(sortBy) : "riskScore";
  const direction = sortDirection === "asc" ? "asc" : "desc";
  return [
    { [safeSortBy]: direction },
    { updatedAt: "desc" },
  ];
}

function mapProductSummary(input: {
  snapshot: DbRecord;
  settings: typeof DEFAULT_RISK_SETTINGS;
  latestDiagnosis?: DbRecord | null;
  watchedItem?: { status?: string | null } | null;
}): AiProductRiskSummary {
  const { snapshot, settings, latestDiagnosis, watchedItem } = input;
  const metrics = asRecord(snapshot.metrics);
  const riskScore = toInteger(latestDiagnosis?.riskScore ?? snapshot.riskScore, 0);
  const confidence = toNullableNumber(latestDiagnosis?.confidence ?? snapshot.confidence);
  const latestDiagnosisId = optionalText(latestDiagnosis?.id) || optionalText(metrics.latestDiagnosisId);

  return {
    productGid: String(snapshot.productGid || ""),
    title: String(snapshot.productTitle || "Shopify product"),
    handle: optionalText(snapshot.handle),
    riskScore,
    riskLabel: getRiskLabel(riskScore, settings),
    impactScore: toNullableNumber(snapshot.impactScore),
    confidence,
    primaryIssue: optionalText(latestDiagnosis?.likelyCause || snapshot.primaryIssue),
    analysisDepth: latestDiagnosisId ? "full" : "quickscan",
    latestDiagnosisId,
    sourceCoverage: arrayOfStrings(snapshot.sourceCoverage).slice(0, 8),
    metrics: mapMetricSummary(metrics),
    isWatched: Boolean(watchedItem),
    watchlistStatus: optionalText(watchedItem?.status),
    calculatedAt: toIso(snapshot.calculatedAt),
    updatedAt: toIso(snapshot.updatedAt),
  };
}

function mapMetricSummary(metrics: Record<string, unknown>): AiProductMetricSummary {
  const monthlySummary = asRecord(asRecord(metrics.monthlyOrderActivity).summary);
  const relationship = buildAiReturnRefundRelationshipSummary(metrics);
  return {
    returnRate: toNullableNumber(monthlySummary.returnRate ?? metrics.returnRate),
    refundRate: toNullableNumber(monthlySummary.refundRate ?? metrics.refundRate),
    reviewRating: toNullableNumber(metrics.reviewRating ?? metrics.avgRating),
    reviewCount: toNullableNumber(metrics.reviewCount),
    negativeReviewCount: toNullableNumber(metrics.negativeReviewCount),
    signalCount: toNullableNumber(metrics.signalCount ?? metrics.issueCount),
    soldUnits: toNullableNumber(metrics.soldUnits ?? monthlySummary.totalOrderUnits),
    returnUnits: toNullableNumber(metrics.returnUnits),
    refundUnits: toNullableNumber(metrics.refundUnits),
    estimatedImpact: toNullableNumber(metrics.estimatedImpact),
    revenueAtRisk: toNullableNumber(metrics.revenueAtRisk),
    marginAtRisk: toNullableNumber(metrics.marginAtRisk),
    productMomentumScore: toNullableNumber(metrics.productMomentumScore ?? asRecord(metrics.productMomentum).score),
    productMomentumTier: optionalText(metrics.productMomentumTier ?? asRecord(metrics.productMomentum).tier),
    returnRefundRelationship: relationship,
    financialExposureBreakdown: buildAiFinancialExposureBreakdown(metrics, relationship),
    purchaseContext: buildAiProductPurchaseContextSummaryFromMetrics(metrics),
    productRelationshipIntelligence: buildAiProductRelationshipSummaryFromMetrics(metrics),
    productRelationshipInsights: buildAiProductRelationshipInsights(metrics),
  };
}

function buildAiReturnRefundRelationshipSummary(metrics: Record<string, unknown>): AiReturnRefundRelationshipSummary | null {
  const summary = asRecord(metrics.returnRefundRelationshipSummary);
  const factors = asRecord(metrics.returnRefundRelationshipFactors);
  const returnPressure = asRecord(metrics.returnPressure || factors.returnPressure);
  const refundLeakage = asRecord(metrics.refundLeakage || factors.refundLeakage);
  const customerSignals = asRecord(metrics.customerSignalBreakdown || factors.customerSignalBreakdown);
  const monthlySummary = asRecord(asRecord(metrics.monthlyOrderActivity).summary);
  const available = Boolean(Object.keys(summary).length || factors.hasRelationshipSummary || returnPressure.returnedAndRefundedUnits || refundLeakage.attributedRefundAmount);
  const soldUnits = firstNumber(summary.sold_units, metrics.soldUnits, monthlySummary.totalOrderUnits);
  const soldOrders = firstNumber(summary.sold_orders, monthlySummary.totalOrders);
  const returnedUnits = firstNumber(summary.returned_units, metrics.returnUnits, monthlySummary.totalReturnedUnits);
  const returnedOrders = firstNumber(summary.returned_orders, monthlySummary.totalReturnedOrders);
  const refundedUnits = firstNumber(summary.refunded_units, metrics.refundUnits, monthlySummary.totalRefundedUnits);
  const refundedOrders = firstNumber(summary.refunded_orders, monthlySummary.totalRefundedOrders);
  const returnedAndRefundedUnits = firstNumber(summary.returned_and_refunded_units, returnPressure.returnedAndRefundedUnits, customerSignals.linkedReturnRefundCount);
  const returnedNotRefundedUnits = firstNumber(summary.returned_not_refunded_units, returnPressure.returnedNotRefundedUnits, customerSignals.returnOnlyCount);
  const refundedWithoutReturnUnits = firstNumber(summary.refunded_without_return_units, customerSignals.refundOnlyCount);
  const exchangeOrReplacementUnits = firstNumber(summary.exchange_or_replacement_units, returnPressure.exchangeOrReplacementUnits, customerSignals.exchangeOrReplacementCount);
  const pendingOrUnknownCount = firstNumber(
    customerSignals.pendingOrUnknownCount,
    firstNumber(summary.pending_return_units, returnPressure.pendingReturnUnits) + firstNumber(summary.relationship_unknown_count),
  );
  const attributedRefundAmount = firstNumber(summary.attributed_refund_amount, refundLeakage.attributedRefundAmount, metrics.refundAmount);
  const unattributedRefundAmount = firstNumber(summary.unattributed_refund_amount, refundLeakage.unattributedRefundAmount);
  const refundAmountWithReturn = firstNumber(summary.refund_amount_with_return, refundLeakage.refundAmountWithReturn);
  const refundAmountWithoutReturn = firstNumber(summary.refund_amount_without_return, refundLeakage.refundAmountWithoutReturn);
  const totalProductRevenue = firstNumber(summary.total_product_revenue, metrics.salesAmount, monthlySummary.totalRevenue);
  const totalRefundAmountRelated = firstNumber(summary.total_refund_amount_related_to_product_or_orders, attributedRefundAmount + unattributedRefundAmount);
  const confidenceAvg = normalizeAiConfidence(firstNumber(
    summary.relationship_match_confidence_avg,
    asRecord(factors.diagnosisConfidence).relationshipMatchConfidenceAvg,
  ));
  const relationship: AiReturnRefundRelationshipSummary = {
    available,
    status: available ? "Relationship matching available" : "Refund relationship not matched yet",
    soldUnits,
    soldOrders,
    returnedUnits,
    returnedOrders,
    refundedUnits,
    refundedOrders,
    returnedAndRefundedUnits,
    returnedNotRefundedUnits,
    refundedWithoutReturnUnits,
    exchangeOrReplacementUnits,
    pendingOrUnknownCount,
    unattributedRefundAmount,
    attributedRefundAmount,
    refundAmountWithReturn,
    refundAmountWithoutReturn,
    totalProductRevenue,
    returnRateUnits: ratePercent(summary.return_rate_units, returnedUnits, soldUnits),
    returnToRefundRate: ratePercent(summary.return_to_refund_rate, returnedAndRefundedUnits, returnedUnits),
    refundWithoutReturnRate: ratePercent(summary.refund_without_return_rate, refundedWithoutReturnUnits, soldUnits),
    refundRateRevenue: ratePercent(summary.refund_rate_revenue, attributedRefundAmount, totalProductRevenue),
    refundAttributionRate: ratePercent(summary.refund_attribution_rate ?? refundLeakage.refundAttributionRate, attributedRefundAmount, totalRefundAmountRelated),
    relationshipMatchConfidenceAvg: confidenceAvg,
    attributionConfidence: getAiAttributionConfidence(confidenceAvg, available),
    interpretation: "",
  };
  relationship.interpretation = getAiRelationshipInterpretation(relationship);
  return relationship;
}

function buildAiReturnRefundResolution(snapshot: DbRecord): AiReturnRefundResolutionSummary {
  const metrics = asRecord(snapshot.metrics);
  const relationship = buildAiReturnRefundRelationshipSummary(metrics);
  const safeRelationship = relationship || buildUnavailableAiReturnRefundRelationshipSummary();
  return {
    productGid: String(snapshot.productGid || ""),
    title: String(snapshot.productTitle || "Shopify product"),
    handle: optionalText(snapshot.handle),
    available: safeRelationship.available,
    status: safeRelationship.status,
    matrix: {
      returnYesRefundYes: safeRelationship.returnedAndRefundedUnits,
      returnYesRefundNo: safeRelationship.returnedNotRefundedUnits,
      returnNoRefundYes: safeRelationship.refundedWithoutReturnUnits,
    },
    buckets: {
      returnAndRefund: safeRelationship.returnedAndRefundedUnits,
      returnOnly: safeRelationship.returnedNotRefundedUnits,
      refundOnly: safeRelationship.refundedWithoutReturnUnits,
      exchangeOrReplacement: safeRelationship.exchangeOrReplacementUnits,
      pendingOrUnknown: safeRelationship.pendingOrUnknownCount,
      unattributedRefundAmount: safeRelationship.unattributedRefundAmount,
    },
    rates: {
      returnedUnitsRefunded: safeRelationship.returnToRefundRate,
      refundsWithoutReturn: safeRelationship.refundWithoutReturnRate,
      refundAttribution: safeRelationship.refundAttributionRate,
    },
    attributionConfidence: safeRelationship.attributionConfidence,
    interpretation: safeRelationship.interpretation,
  };
}

function buildUnavailableAiReturnRefundRelationshipSummary(): AiReturnRefundRelationshipSummary {
  return {
    available: false,
    status: "Refund relationship not matched yet",
    soldUnits: 0,
    soldOrders: 0,
    returnedUnits: 0,
    returnedOrders: 0,
    refundedUnits: 0,
    refundedOrders: 0,
    returnedAndRefundedUnits: 0,
    returnedNotRefundedUnits: 0,
    refundedWithoutReturnUnits: 0,
    exchangeOrReplacementUnits: 0,
    pendingOrUnknownCount: 0,
    unattributedRefundAmount: 0,
    attributedRefundAmount: 0,
    refundAmountWithReturn: 0,
    refundAmountWithoutReturn: 0,
    totalProductRevenue: 0,
    returnRateUnits: 0,
    returnToRefundRate: 0,
    refundWithoutReturnRate: 0,
    refundRateRevenue: 0,
    refundAttributionRate: 0,
    relationshipMatchConfidenceAvg: 0,
    attributionConfidence: "Unavailable",
    interpretation: "Return/refund relationship matching is not available for this product yet.",
  };
}

function buildAiFinancialExposureBreakdown(
  metrics: Record<string, unknown>,
  relationship: AiReturnRefundRelationshipSummary | null = buildAiReturnRefundRelationshipSummary(metrics),
): AiFinancialExposureBreakdown {
  const breakdown = asRecord(metrics.financialExposureBreakdown || asRecord(metrics.returnRefundRelationshipFactors).financialExposure);
  const confirmedRefundAmount = firstNumber(breakdown.confirmedRefundAmount, relationship?.attributedRefundAmount, metrics.refundAmount);
  const estimatedFutureRefundFromReturnOnlyCases = firstNumber(breakdown.estimatedFutureRefundFromReturnOnlyCases);
  const returnRelatedRiskAmount = firstNumber(breakdown.returnRelatedRiskAmount, estimatedFutureRefundFromReturnOnlyCases);
  const estimatedExposure = firstNumber(breakdown.relationshipAdjustedRefundAmount, metrics.estimatedImpact, metrics.revenueAtRisk, confirmedRefundAmount + returnRelatedRiskAmount);
  const totalRefundAmountRelated = firstNumber(
    breakdown.totalRefundAmountRelated,
    Number(relationship?.attributedRefundAmount || 0) + Number(relationship?.unattributedRefundAmount || 0),
  );
  const exposure: AiFinancialExposureBreakdown = {
    available: Boolean(Object.keys(breakdown).length || relationship?.available || estimatedExposure || confirmedRefundAmount),
    estimatedExposure,
    confirmedRefundAmount,
    attributedRefundAmount: firstNumber(breakdown.attributedRefundAmount, confirmedRefundAmount),
    refundAmountWithReturn: firstNumber(breakdown.refundAmountWithReturn, relationship?.refundAmountWithReturn),
    refundAmountWithoutReturn: firstNumber(breakdown.refundAmountWithoutReturn, relationship?.refundAmountWithoutReturn),
    unattributedRefundAmount: firstNumber(breakdown.unattributedRefundAmount, relationship?.unattributedRefundAmount),
    returnRelatedRiskAmount,
    estimatedFutureRefundFromReturnOnlyCases,
    refundAttributionRate: ratePercent(breakdown.refundAttributionRate, relationship?.attributedRefundAmount, totalRefundAmountRelated),
    interpretation: "",
  };
  exposure.interpretation = getAiFinancialExposureInterpretation(exposure);
  return exposure;
}

function buildAiProductPurchaseContextSummary(snapshot: DbRecord): AiProductPurchaseContextSummary {
  return buildAiProductPurchaseContextSummaryFromMetrics(asRecord(snapshot.metrics), {
    productGid: String(snapshot.productGid || ""),
    title: String(snapshot.productTitle || "Shopify product"),
    handle: optionalText(snapshot.handle),
  });
}

function buildAiProductPurchaseContextSummaryFromMetrics(
  metrics: Record<string, unknown>,
  product: { productGid?: string | null; title?: string | null; handle?: string | null } = {},
): AiProductPurchaseContextSummary {
  const summary = asRecord(metrics.productPurchaseContextSummary);
  const factors = asRecord(metrics.productPurchaseContextFactors);
  const signalBreakdown = asRecord(metrics.purchaseContextSignalBreakdown || factors.customerSignalBreakdown);
  const scoringImpact = arrayOfStrings(metrics.productPurchaseContextScoringImpact).slice(0, 5);
  const available = Boolean(Object.keys(summary).length || factors.hasPurchaseContextSummary);
  const totalOrders = firstNumber(summary.total_orders_containing_product, summary.totalOrdersContainingProduct);
  const totalUnits = firstNumber(summary.total_units_sold, summary.totalUnitsSold);
  const soloOrders = firstNumber(summary.solo_product_order_count, summary.soloProductOrderCount);
  const multiProductOrders = firstNumber(summary.multi_product_order_count, summary.multiProductOrderCount);
  const singleUnitOrders = firstNumber(summary.single_unit_order_count, summary.singleUnitOrderCount);
  const multiUnitOrders = firstNumber(summary.multi_unit_order_count, summary.multiUnitOrderCount);
  const bulkOrders = firstNumber(summary.bulk_order_count, summary.bulkOrderCount);
  const multiVariantOrders = firstNumber(summary.multi_variant_order_count, summary.multiVariantOrderCount);
  const confidence = normalizeAiConfidence(firstNumber(summary.purchase_context_confidence, summary.purchaseContextConfidence));
  const context: AiProductPurchaseContextSummary = {
    available,
    status: available ? (totalOrders > 0 ? "Purchase context available" : "No product-containing orders in the stored window") : "Purchase context not calculated yet",
    productGid: product.productGid || optionalText(summary.product_id),
    title: product.title || null,
    handle: product.handle || null,
    totalOrdersContainingProduct: totalOrders,
    totalUnitsSold: totalUnits,
    totalRevenueIfAvailable: firstNumber(summary.total_revenue_if_available, summary.totalRevenueIfAvailable),
    soloProductOrderCount: soloOrders,
    multiProductOrderCount: multiProductOrders,
    singleUnitOrderCount: singleUnitOrders,
    multiUnitOrderCount: multiUnitOrders,
    bulkOrderCount: bulkOrders,
    multiVariantOrderCount: multiVariantOrders,
    avgProductQuantityPerOrder: firstNumber(summary.avg_product_quantity_per_order, summary.avgProductQuantityPerOrder, summary.avg_product_qty_per_order),
    avgDistinctProductsPerOrder: firstNumber(summary.avg_distinct_products_per_order, summary.avgDistinctProductsPerOrder),
    soloPurchaseRate: ratePercent(summary.solo_purchase_rate ?? summary.soloPurchaseRate, soloOrders, totalOrders),
    multiProductBasketRate: ratePercent(summary.multi_product_basket_rate ?? summary.multiProductBasketRate, multiProductOrders, totalOrders),
    singleUnitPurchaseRate: ratePercent(summary.single_unit_purchase_rate ?? summary.singleUnitPurchaseRate, singleUnitOrders, totalOrders),
    multiUnitPurchaseRate: ratePercent(summary.multi_unit_purchase_rate ?? summary.multiUnitPurchaseRate, multiUnitOrders, totalOrders),
    bulkPurchaseRate: ratePercent(summary.bulk_purchase_rate ?? summary.bulkPurchaseRate, bulkOrders, totalOrders),
    multiVariantOrderRate: ratePercent(summary.multi_variant_order_rate ?? summary.multiVariantOrderRate, multiVariantOrders, totalOrders),
    purchaseContextConfidence: confidence,
    purchaseContextConfidenceLabel: getAiPurchaseContextConfidenceLabel(confidence, available),
    unknownOrIncompleteOrderCount: firstNumber(summary.unknown_or_incomplete_order_count, summary.unknownOrIncompleteOrderCount),
    quantityDistribution: buildAiPurchaseQuantityDistribution(asRecord(summary.quantity_distribution || summary.quantityDistribution), totalOrders),
    topCoPurchasedProducts: arrayOfRecords(summary.top_co_purchased_products || summary.topCoPurchasedProducts)
      .slice(0, 5)
      .map((item) => ({
        productId: optionalText(item.productId || item.product_id || item.id),
        title: optionalText(item.title || item.productTitle || item.product_title) || "Unknown product",
        handle: optionalText(item.handle || item.productHandle || item.product_handle),
        coOrderCount: firstNumber(item.co_order_count, item.coOrderCount),
        coOrderRate: ratePercent(item.co_order_rate ?? item.coOrderRate),
        affinityScore: toNullableNumber(item.affinity_score ?? item.affinityScore),
      })),
    interpretation: optionalText(summary.interpretation)
      || scoringImpact[0]
      || getAiPurchaseContextInterpretation({ available, totalOrders, soloOrders, multiProductOrders, signalBreakdown }),
  };
  return context;
}

function buildAiPurchaseQuantityDistribution(distribution: Record<string, unknown>, totalOrders: number): AiProductPurchaseContextSummary["quantityDistribution"] {
  const oneUnitCount = firstNumber(distribution.one_unit_count, distribution.oneUnitCount);
  const twoUnitCount = firstNumber(distribution.two_unit_count, distribution.twoUnitCount);
  const threeUnitCount = firstNumber(distribution.three_unit_count, distribution.threeUnitCount);
  const fourPlusUnitCount = firstNumber(distribution.four_plus_unit_count, distribution.fourPlusUnitCount);
  return {
    oneUnitCount,
    twoUnitCount,
    threeUnitCount,
    fourPlusUnitCount,
    oneUnitRate: ratePercent(distribution.one_unit_rate ?? distribution.oneUnitRate, oneUnitCount, totalOrders),
    twoUnitRate: ratePercent(distribution.two_unit_rate ?? distribution.twoUnitRate, twoUnitCount, totalOrders),
    threeUnitRate: ratePercent(distribution.three_unit_rate ?? distribution.threeUnitRate, threeUnitCount, totalOrders),
    fourPlusUnitRate: ratePercent(distribution.four_plus_unit_rate ?? distribution.fourPlusUnitRate, fourPlusUnitCount, totalOrders),
  };
}

function buildAiProductPurchaseContextRiskImpact(metrics: Record<string, unknown>): AiProductPurchaseContextRiskImpact {
  const context = buildAiProductPurchaseContextSummaryFromMetrics(metrics);
  const factors = asRecord(metrics.productPurchaseContextFactors);
  const explanations = arrayOfStrings(metrics.productPurchaseContextScoringImpact).slice(0, 6);
  return {
    available: context.available,
    riskImpact: getAiPurchaseContextRiskImpactText(context, asRecord(factors.productRisk)),
    confidenceImpact: getAiPurchaseContextConfidenceImpactText(context, asRecord(factors.diagnosisConfidence)),
    financialExposureImpact: getAiPurchaseContextFinancialExposureImpactText(context, asRecord(factors.financialExposure)),
    returnPressureImpact: getAiPurchaseContextReturnPressureImpactText(asRecord(factors.returnPressure)),
    refundLeakageImpact: getAiPurchaseContextRefundLeakageImpactText(asRecord(factors.refundLeakage)),
    explanations,
  };
}

function getAiPurchaseContextConfidenceLabel(confidence: number, available: boolean): AiProductPurchaseContextSummary["purchaseContextConfidenceLabel"] {
  if (!available || confidence <= 0) return "Unavailable";
  if (confidence >= 80) return "High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

function getAiPurchaseContextInterpretation({
  available,
  totalOrders,
  soloOrders,
  multiProductOrders,
  signalBreakdown,
}: {
  available: boolean;
  totalOrders: number;
  soloOrders: number;
  multiProductOrders: number;
  signalBreakdown: Record<string, unknown>;
}): string {
  const primaryContext = optionalText(signalBreakdown.primaryContext);
  if (primaryContext) return `${primaryContext}.`;
  if (!available) return "Purchase context is not calculated for this product yet.";
  if (!totalOrders) return "No product-containing orders were available in the stored purchase context window.";
  if (soloOrders >= multiProductOrders) return "This product is mostly bought alone, so product-level signals are easier to attribute.";
  return "This product is often bought with other products, so order-level signals can be less conclusive.";
}

function getAiPurchaseContextRiskImpactText(context: AiProductPurchaseContextSummary, productRisk: Record<string, unknown>): string {
  if (!context.available) return "Purchase context is not available and does not affect Product Risk.";
  if (firstNumber(productRisk.multiVariantRisk) > 0) return "Multi-variant orders add a small variant or fit uncertainty signal.";
  if (firstNumber(productRisk.soloAttributionRisk) > 0) return "Solo-purchase behavior strengthens product-specific attribution when negative signals exist.";
  if (context.multiProductBasketRate >= 60) return "Multi-product baskets reduce confidence in weak order-level product attribution.";
  return "Purchase context is available but does not materially change Product Risk.";
}

function getAiPurchaseContextConfidenceImpactText(context: AiProductPurchaseContextSummary, confidence: Record<string, unknown>): string {
  if (!context.available) return "Purchase context is unavailable, so confidence cannot use basket behavior.";
  if (firstNumber(confidence.multiProductAttributionPenalty) > 0) return "Diagnosis confidence is lower because multi-product baskets make weak order-level signals less conclusive.";
  if (context.soloPurchaseRate >= 60) return "Diagnosis confidence is higher because the product is often bought alone.";
  if (context.purchaseContextConfidence < 55) return "Diagnosis confidence is limited because purchase context quality is low.";
  return "Purchase context supports diagnosis confidence without a strong penalty.";
}

function getAiPurchaseContextFinancialExposureImpactText(context: AiProductPurchaseContextSummary, exposure: Record<string, unknown>): string {
  if (!context.available) return "Purchase context is unavailable for financial exposure.";
  if (firstNumber(exposure.bulkQuantityExposure) > 0) return "Bulk or multi-unit orders increase potential unit exposure when bad events occur.";
  return "Purchase context does not add material financial exposure.";
}

function getAiPurchaseContextReturnPressureImpactText(returnPressure: Record<string, unknown>): string {
  const alone = firstNumber(returnPressure.returnRateWhenBoughtAlone);
  const basket = firstNumber(returnPressure.returnRateWhenBoughtWithOthers);
  const multiVariant = firstNumber(returnPressure.returnRateForMultiVariantOrders);
  if (multiVariant >= Math.max(alone, basket, 1)) return "Returns are most notable in multi-variant orders.";
  if (basket > alone) return "Returns are higher when the product is bought with other products.";
  if (alone > basket) return "Returns are higher when the product is bought alone.";
  return "No purchase-context return-pressure segment stands out.";
}

function getAiPurchaseContextRefundLeakageImpactText(refundLeakage: Record<string, unknown>): string {
  const alone = firstNumber(refundLeakage.refundRateWhenBoughtAlone);
  const basket = firstNumber(refundLeakage.refundRateWhenBoughtWithOthers);
  if (basket > alone) return "Refund leakage is higher when the product is bought with other products.";
  if (alone > basket) return "Refund leakage is higher when the product is bought alone.";
  return "No purchase-context refund-leakage segment stands out.";
}

function buildAiProductRelationshipSummary(snapshot: DbRecord): AiProductRelationshipSummary {
  return buildAiProductRelationshipSummaryFromMetrics(asRecord(snapshot.metrics), {
    productGid: String(snapshot.productGid || ""),
    title: String(snapshot.productTitle || "Shopify product"),
    handle: optionalText(snapshot.handle),
  });
}

function buildAiProductRelationshipSummaryFromMetrics(
  metrics: Record<string, unknown>,
  product: { productGid?: string | null; title?: string | null; handle?: string | null } = {},
): AiProductRelationshipSummary {
  const summary = asRecord(metrics.productRelationshipIntelligenceSummary);
  const factors = asRecord(metrics.productRelationshipFactors);
  const context = asRecord(factors.context);
  const confidenceRecord = asRecord(summary.confidence);
  const dataBasis = asRecord(summary.data_basis);
  const available = Boolean(Object.keys(summary).length || factors.hasProductRelationshipSummary || context.strongestRelationships);
  const confidenceScore = normalizeAiConfidence(firstNumber(confidenceRecord.score, context.confidenceScore));
  const relationshipSummary: AiProductRelationshipSummary = {
    available,
    status: available ? "Product relationship metrics available" : "Product relationship metrics not calculated yet",
    productGid: product.productGid || optionalText(summary.source_product_id),
    title: product.title || null,
    handle: product.handle || null,
    confidenceScore,
    confidenceLabel: optionalText(confidenceRecord.label || context.confidenceLabel) || getAiProductRelationshipConfidenceLabel(confidenceScore, available),
    orderCount: firstNumber(dataBasis.order_count, context.orderCount),
    customerCount: firstNumber(dataBasis.customer_count, context.customerCount),
    topBoughtTogether: buildAiProductRelationshipItems(summary.top_bought_together || summary.same_order_relationships || context.topBoughtTogether),
    topBoughtBefore: buildAiProductRelationshipItems(summary.top_bought_before || summary.previous_purchase_relationships || context.topBoughtBefore),
    topBoughtAfter: buildAiProductRelationshipItems(summary.top_bought_after || summary.next_purchase_relationships || context.topBoughtAfter),
    strongestRelationships: buildAiProductRelationshipItems(summary.strongest_relationships || context.strongestRelationships),
    emergingRelationships: buildAiProductRelationshipItems(summary.emerging_relationships || context.emergingRelationships),
    relationshipsWithReturnRiskImpact: buildAiProductRelationshipItems(summary.relationships_with_return_risk_impact || asRecord(factors.aiInsightInput).riskRelationships),
    relationshipsWithCrossSellOpportunity: buildAiProductRelationshipItems(summary.relationships_with_cross_sell_opportunity || asRecord(factors.aiInsightInput).crossSellOpportunities),
    warnings: arrayOfStrings(summary.warnings || context.warnings).slice(0, 8),
    interpretation: "",
  };
  relationshipSummary.interpretation = getAiProductRelationshipInterpretation(relationshipSummary);
  return relationshipSummary;
}

function buildAiProductRelationshipItems(value: unknown): AiProductRelationshipItem[] {
  return arrayOfRecords(value)
    .slice(0, 8)
    .map((item) => ({
      relatedProductId: optionalText(item.relatedProductId || item.related_product_id),
      title: truncate(optionalText(item.relatedProductTitle || item.related_product_title || item.title) || "Unknown product", 180),
      handle: optionalText(item.relatedProductHandle || item.related_product_handle || item.handle),
      relationshipType: optionalText(item.relationshipType || item.relationship_type) || "",
      direction: optionalText(item.direction || item.relationshipDirection || item.relationship_direction) || "",
      timeWindow: optionalText(item.timeWindow || item.time_window) || "",
      relationshipRate: ratePercent(item.relationshipRate ?? item.relationship_rate),
      attachRate: ratePercent(item.attachRate ?? item.attach_rate),
      lift: toNullableNumber(item.lift),
      confidence: normalizeAiConfidence(item.confidence),
      confidenceLabel: optionalText(item.confidenceLabel || item.confidence_label) || getAiProductRelationshipConfidenceLabel(normalizeAiConfidence(item.confidence), true),
      sampleSize: firstNumber(item.sampleSize, item.sample_size),
      relationshipStrength: optionalText(item.relationshipStrength || item.relationship_strength) || "",
      trend: optionalText(item.trend) || "insufficient_data",
      deltaReturnRate: ratePercent(item.deltaReturnRate ?? item.delta_return_rate),
      deltaRefundRate: ratePercent(item.deltaRefundRate ?? item.delta_refund_rate),
    }))
    .filter((item) => item.relatedProductId || item.title !== "Unknown product");
}

function buildAiProductRelationshipRiskImpact(metrics: Record<string, unknown>): AiProductRelationshipRiskImpact {
  const summary = buildAiProductRelationshipSummaryFromMetrics(metrics);
  const factors = asRecord(metrics.productRelationshipFactors);
  const productRisk = asRecord(factors.productRiskContext);
  const confidence = asRecord(factors.diagnosisConfidence);
  const actionSignals = asRecord(factors.recommendedActionSignals);
  const explanations = arrayOfStrings(metrics.productRelationshipScoringImpact).slice(0, 6);
  return {
    available: summary.available,
    riskImpact: getAiProductRelationshipRiskImpactText(summary, productRisk),
    confidenceImpact: getAiProductRelationshipConfidenceImpactText(summary, confidence),
    opportunityImpact: getAiProductRelationshipOpportunityImpactText(actionSignals),
    explanations,
  };
}

function buildAiProductRelationshipInsights(metrics: Record<string, unknown>): AiProductRelationshipInsights {
  const report = asRecord(metrics.diagnosisReport);
  const stored = asRecord(metrics.productRelationshipAiInsights || report.relationshipInsights);
  const deterministicInputs = asRecord(stored.deterministicInputs);
  const insights = arrayOfRecords(stored.insights)
    .slice(0, 5)
    .map((item, index) => ({
      id: optionalText(item.id) || `relationship-insight-${index + 1}`,
      type: optionalText(item.type) || "relationship_context",
      sourceRelationshipId: optionalText(item.sourceRelationshipId) || "",
      relatedProductTitle: truncate(optionalText(item.relatedProductTitle) || "Unknown product", 180),
      summary: truncate(optionalText(item.summary) || "", 420),
      recommendation: truncate(optionalText(item.recommendation) || "", 320),
      caveat: truncate(optionalText(item.caveat) || "", 260),
      metrics: sanitizeInsightMetrics(asRecord(item.metrics)),
    }))
    .filter((item) => item.summary);
  return {
    available: Boolean(stored.available && insights.length),
    status: optionalText(stored.status) || (insights.length ? "available" : "not_available"),
    insightVersion: optionalText(stored.insightVersion),
    generatedAt: optionalText(stored.generatedAt),
    model: optionalText(stored.model),
    insights,
    deterministicInputs: {
      relationshipCount: firstNumber(deterministicInputs.relationshipCount),
      confidenceScore: firstNumber(deterministicInputs.confidenceScore),
      warnings: arrayOfStrings(deterministicInputs.warnings).slice(0, 8),
    },
  };
}

function sanitizeInsightMetrics(metrics: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  [
    "relationshipType",
    "direction",
    "timeWindow",
    "relationshipStrength",
    "trend",
  ].forEach((key) => {
    const value = optionalText(metrics[key]);
    if (value) safe[key] = truncate(value, 80);
  });
  [
    "lift",
    "confidence",
    "sampleSize",
    "deltaReturnRate",
    "deltaRefundRate",
  ].forEach((key) => {
    const value = toNullableNumber(metrics[key]);
    if (value !== null) safe[key] = value;
  });
  return safe;
}

function getAiProductRelationshipConfidenceLabel(confidence: number, available: boolean): AiProductRelationshipSummary["confidenceLabel"] {
  if (!available || confidence <= 0) return "Unavailable";
  if (confidence >= 80) return "High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

function getAiProductRelationshipInterpretation(summary: AiProductRelationshipSummary): string {
  if (!summary.available) return "Product relationship metrics are not available for this product yet.";
  if (summary.relationshipsWithReturnRiskImpact.length) {
    const related = summary.relationshipsWithReturnRiskImpact[0];
    return `Return/refund pressure is higher in at least one related-product context, led by ${related.title}. Treat this as risk context, not causality.`;
  }
  if (summary.topBoughtAfter.length) return `${summary.topBoughtAfter[0].title} is a follow-on purchase candidate after this product.`;
  if (summary.topBoughtTogether.length) return `${summary.topBoughtTogether[0].title} is a same-order relationship candidate for merchandising review.`;
  return "Relationship data is available but does not show a strong actionable pattern yet.";
}

function getAiProductRelationshipRiskImpactText(summary: AiProductRelationshipSummary, productRisk: Record<string, unknown>): string {
  if (!summary.available) return "Product relationships are unavailable and do not affect Product Risk.";
  if (firstNumber(productRisk.relationshipRiskImpactCount) > 0 || summary.relationshipsWithReturnRiskImpact.length) {
    return "Relationship data adds risk context because return/refund pressure is higher with a related product, but it does not directly overwrite Product Risk.";
  }
  return "Product relationships are treated as contextual signals and do not directly increase Product Risk.";
}

function getAiProductRelationshipConfidenceImpactText(summary: AiProductRelationshipSummary, confidence: Record<string, unknown>): string {
  if (!summary.available) return "Product relationships are unavailable, so diagnosis confidence cannot use relationship context.";
  if (firstNumber(confidence.complexBasketAmbiguityPenalty) > 0) return "Diagnosis confidence is lower because bad outcomes happen in relationship-heavy basket contexts.";
  if (firstNumber(confidence.sequenceStabilityScore) > 0) return "Stable relationship patterns add context to the diagnosis explanation.";
  if (summary.confidenceScore < 55) return "Relationship evidence is low-confidence and should be treated cautiously.";
  return "Relationship context is available without a material confidence penalty.";
}

function getAiProductRelationshipOpportunityImpactText(actionSignals: Record<string, unknown>): string {
  if (actionSignals.compatibilityWarning) return "A related product pairing may need compatibility or expectation review.";
  if (actionSignals.bundleOpportunity) return "A high-lift same-order relationship may support bundle or frequently-bought-together review.";
  if (actionSignals.crossSellOpportunity) return "A follow-on relationship may support post-purchase cross-sell review.";
  if (actionSignals.journeyInsight) return "A previous-purchase pattern may support upgrade or next-step positioning.";
  return "No relationship-based recommendation is currently strong enough to surface.";
}

function mapDiagnosisSummary(
  diagnosis: DbRecord,
  productGid: string,
  options: { evidenceLimit: number; issueLimit: number; recommendationLimit: number },
): AiDiagnosisSummary {
  return {
    id: String(diagnosis.id || ""),
    status: String(diagnosis.status || ""),
    riskScore: toNullableNumber(diagnosis.riskScore),
    confidence: toNullableNumber(diagnosis.confidence),
    likelyCause: optionalText(diagnosis.likelyCause),
    completedAt: toIso(diagnosis.completedAt),
    createdAt: toIso(diagnosis.createdAt),
    issues: arrayOfRecords(diagnosis.issues).slice(0, options.issueLimit).map(mapIssueSummary),
    evidence: arrayOfRecords(diagnosis.evidence)
      .slice(0, options.evidenceLimit)
      .map((item, index) => mapEvidenceSnippet(item, index, productGid, "diagnosis", optionalText(diagnosis.id))),
    recommendations: (filterDisabledProductActions(arrayOfRecords(diagnosis.recommendations)) as Record<string, unknown>[])
      .slice(0, options.recommendationLimit)
      .map(mapRecommendationSummary),
  };
}

function mapIssueSummary(issue: Record<string, unknown>): AiIssueSummary {
  return {
    issue: truncate(optionalText(issue.issue || issue.label) || "Product issue", 180),
    issueCode: optionalText(issue.issueCode || issue.code),
    severity: optionalText(issue.severity),
    confidence: toNullableNumber(issue.confidence),
    signals: toNullableNumber(issue.signals),
    sourceTypes: arrayOfStrings(issue.sourceTypes || issue.source_types).slice(0, 6),
    evidence: arrayOfStrings(issue.evidence).map((item) => truncate(item, 220)).slice(0, 5),
    suggestedAction: optionalText(issue.action || issue.suggestedAction || issue.suggested_action),
  };
}

function mapEvidenceSnippet(
  item: Record<string, unknown>,
  index: number,
  productGid: string,
  referenceType: AiEvidenceSnippet["referenceType"],
  referenceId: string | null,
): AiEvidenceSnippet {
  return {
    id: `${referenceType}-${referenceId || "snapshot"}-${index + 1}`,
    productGid,
    source: truncate(optionalText(item.source || item.sourceTitle || item.provider) || "ProductPulse evidence", 120),
    quote: truncate(optionalText(item.quote || item.summary || item.body || item.detail || item.label) || "", 360),
    weight: optionalText(item.weight) ? truncate(String(item.weight), 180) : null,
    points: arrayOfEvidencePointText(item.points || item.items).slice(0, 5),
    referenceType,
    referenceId,
  };
}

function mapRecommendationSummary(action: Record<string, unknown>): AiRecommendationSummary {
  const payload = asRecord(action.payload);
  return {
    id: String(action.id || action.actionId || action.label || "recommendation"),
    label: truncate(optionalText(action.label || action.title) || "Recommendation", 180),
    type: optionalText(action.type || action.actionType),
    status: optionalText(action.status),
    effort: optionalText(action.effort),
    issue: optionalText(payload.issue || action.issue),
    draftPreview: getDraftPreview(payload),
    payloadSummary: summarizePayload(payload),
  };
}

function mapActionHistorySummary(action: DbRecord): AiActionHistorySummary {
  return {
    id: String(action.id || ""),
    actionType: String(action.actionType || ""),
    label: truncate(String(action.label || "Product action"), 180),
    status: String(action.status || ""),
    createdAt: toIso(action.createdAt),
    appliedAt: toIso(action.appliedAt),
    payloadSummary: summarizePayload(asRecord(action.payload)),
  };
}

function mapSourceSummary(source: DbRecord): AiSourceSummary {
  return {
    sourceKey: String(source.sourceKey || ""),
    category: String(source.category || ""),
    name: String(source.name || ""),
    connected: Boolean(source.connected),
    active: Boolean(source.active),
    available: Boolean(source.available),
    health: String(source.health || ""),
    coverageWeight: toInteger(source.coverageWeight, 0),
    lastSyncedAt: toIso(source.lastSyncedAt),
    connectedAt: toIso(source.connectedAt),
  };
}

function mapWatchlistItemSummary(
  item: DbRecord,
  snapshot: DbRecord | null,
  settings: typeof DEFAULT_RISK_SETTINGS,
): AiWatchlistItemSummary {
  const riskScore = snapshot ? toNullableNumber(snapshot.riskScore) : null;
  return {
    id: String(item.id || ""),
    productGid: String(item.productGid || ""),
    title: String(item.productTitle || "Shopify product"),
    handle: optionalText(item.handle),
    sku: optionalText(item.sku),
    status: String(item.status || "Watching"),
    riskScore,
    riskLabel: riskScore === null ? null : getRiskLabel(riskScore, settings),
    primaryIssue: optionalText(snapshot?.primaryIssue),
    lastUpdatedAt: toIso(snapshot?.updatedAt || item.updatedAt),
    addedAt: toIso(item.addedAt),
  };
}

function mapRecentActivityItem(activity: DbRecord): AiRecentActivityItem {
  const metadata = asRecord(activity.metadata);
  return {
    id: String(activity.id || ""),
    eventType: String(activity.eventType || ""),
    title: truncate(String(activity.title || "Watch activity"), 160),
    detail: optionalText(activity.detail) ? truncate(String(activity.detail), 220) : null,
    productGid: optionalText(activity.productGid),
    productTitle: optionalText(activity.productTitle),
    riskScore: toNullableNumber(metadata.riskScore),
    riskLabel: optionalText(metadata.riskLabel),
    createdAt: toIso(activity.createdAt),
  };
}

function mapMainFinding(metricsValue: unknown): AiProductRiskDetail["mainFinding"] {
  const report = asRecord(asRecord(metricsValue).diagnosisReport);
  const mainFinding = asRecord(report.mainFinding);
  if (!Object.keys(mainFinding).length) return null;
  return {
    title: optionalText(mainFinding.title),
    detail: optionalText(mainFinding.detail) ? truncate(String(mainFinding.detail), 420) : null,
    summary: optionalText(mainFinding.summary) ? truncate(String(mainFinding.summary), 420) : null,
  };
}

function stripProductDetail(detail: AiProductRiskDetail): AiProductRiskSummary {
  return {
    productGid: detail.productGid,
    title: detail.title,
    handle: detail.handle,
    riskScore: detail.riskScore,
    riskLabel: detail.riskLabel,
    impactScore: detail.impactScore,
    confidence: detail.confidence,
    primaryIssue: detail.primaryIssue,
    analysisDepth: detail.analysisDepth,
    latestDiagnosisId: detail.latestDiagnosisId,
    sourceCoverage: detail.sourceCoverage,
    metrics: detail.metrics,
    isWatched: detail.isWatched,
    watchlistStatus: detail.watchlistStatus,
    calculatedAt: detail.calculatedAt,
    updatedAt: detail.updatedAt,
  };
}

function buildSnapshotEvidence(product: AiProductRiskSummary): AiEvidenceSnippet[] {
  const metrics = product.metrics;
  const evidence: Array<Record<string, unknown>> = [{
    source: "ProductPulse snapshot",
    quote: product.primaryIssue || "Stored ProductPulse product risk snapshot",
    weight: `${product.riskLabel} risk (${product.riskScore}/100)`,
  }];
  if (metrics.returnRate !== null || metrics.returnUnits !== null) {
    evidence.push({
      source: "Returns",
      quote: `${metrics.returnRate ?? 0}% return rate`,
      weight: `${metrics.returnUnits ?? 0} returned units`,
    });
  }
  if (metrics.refundRate !== null || metrics.refundUnits !== null || metrics.revenueAtRisk !== null) {
    evidence.push({
      source: "Refunds",
      quote: `${metrics.refundRate ?? 0}% refund rate`,
      weight: `${metrics.refundUnits ?? 0} refunded units`,
    });
  }
  if (metrics.reviewCount !== null || metrics.negativeReviewCount !== null) {
    evidence.push({
      source: "Reviews",
      quote: `${metrics.negativeReviewCount ?? 0} negative reviews`,
      weight: `${metrics.reviewCount ?? 0} total reviews, ${metrics.reviewRating ?? 0} average rating`,
    });
  }

  return evidence.map((item, index) => mapEvidenceSnippet(item, index, product.productGid, "snapshot", product.productGid));
}

function getDraftPreview(payload: Record<string, unknown>): string | null {
  const draft = optionalText(payload.draftText || payload.draftHandle || payload.note || payload.mediaGuidance);
  return draft ? truncate(draft, 280) : null;
}

function summarizePayload(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const summary: Record<string, string | number | boolean | null> = {};
  const safeKeys = [
    "issue",
    "field",
    "tag",
    "operation",
    "placement",
    "changeStrategy",
    "trigger",
    "refundRate",
    "returnRate",
    "refundUnits",
    "returnUnits",
    "negativeReviewCount",
    "avgRating",
    "contentQualityScore",
    "variantCount",
    "mediaCount",
    "mediaWithoutAltCount",
    "recommendationKind",
    "relatedProductTitle",
    "relationshipType",
    "relationshipDirection",
    "timeWindow",
    "lift",
    "confidence",
    "sampleSize",
    "deltaReturnRate",
    "deltaRefundRate",
  ];

  safeKeys.forEach((key) => {
    const value = payload[key];
    if (value === undefined) return;
    if (typeof value === "string") summary[key] = truncate(value, 160);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) summary[key] = value;
  });

  [
    "topReturnReasons",
    "affectedVariants",
    "focusSources",
    "contentIssues",
    "reviewSections",
    "mediaUpdates",
    "variantUpdates",
  ].forEach((key) => {
    const value = payload[key];
    if (Array.isArray(value)) summary[`${key}Count`] = value.length;
  });

  return summary;
}

function arrayOfEvidencePointText(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return optionalText(record.body || record.text || record.summary || record.detail || record.evidence || record.label || record.title);
    })
    .filter((item): item is string => Boolean(item))
    .map((item) => truncate(item, 260));
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item) => Object.keys(item).length)
    : [];
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(optionalText).filter((item): item is string => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProductRef(value: unknown): string {
  const raw = String(value || "").trim();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeRiskSettings(value: unknown): typeof DEFAULT_RISK_SETTINGS {
  const risk = asRecord(asRecord(value).risk);
  const minimumScore = clampInteger(risk.minimumScore, 0, 90, DEFAULT_RISK_SETTINGS.minimumScore);
  const mediumThreshold = clampInteger(
    risk.mediumThreshold,
    minimumScore + 1,
    95,
    Math.max(DEFAULT_RISK_SETTINGS.mediumThreshold, minimumScore + 1),
  );
  const highThreshold = clampInteger(
    risk.highThreshold,
    mediumThreshold + 1,
    100,
    Math.max(DEFAULT_RISK_SETTINGS.highThreshold, mediumThreshold + 1),
  );
  return { minimumScore, mediumThreshold, highThreshold };
}

function normalizeWatchSettings(value: unknown): WatchSettingsInput & { alertRecipientCount: number } {
  const settings = asRecord(value);
  const alertRecipients = arrayOfStrings(settings.alertRecipients);
  return {
    scanCadenceDays: clampInteger(settings.scanCadenceDays, 1, 30, DEFAULT_WATCH_SETTINGS.scanCadenceDays),
    alertRecipients: [],
    triggerRule: optionalText(settings.triggerRule) || DEFAULT_WATCH_SETTINGS.triggerRule,
    summarySchedule: optionalText(settings.summarySchedule) || DEFAULT_WATCH_SETTINGS.summarySchedule,
    alertsEnabled: typeof settings.alertsEnabled === "boolean" ? settings.alertsEnabled : DEFAULT_WATCH_SETTINGS.alertsEnabled,
    alertRecipientCount: alertRecipients.length,
  };
}

function getRiskLabel(score: number, settings: typeof DEFAULT_RISK_SETTINGS): string {
  if (score >= settings.highThreshold) return "High";
  if (score >= settings.mediumThreshold) return "Medium";
  return "Low";
}

function toInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function ratePercent(value: unknown, numerator = 0, denominator = 0): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return round(parsed <= 1 ? parsed * 100 : parsed, 1);
  const count = Number(numerator || 0);
  const population = Number(denominator || 0);
  return population > 0 ? round((count / population) * 100, 1) : 0;
}

function normalizeAiConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return round(parsed <= 1 ? parsed * 100 : parsed, 1);
}

function getAiAttributionConfidence(confidence: number, available: boolean): AiReturnRefundRelationshipSummary["attributionConfidence"] {
  if (!available) return "Unavailable";
  if (confidence >= 80) return "High";
  if (confidence >= 55) return "Medium";
  return "Low";
}

function getAiRelationshipInterpretation(relationship: AiReturnRefundRelationshipSummary): string {
  if (!relationship.available) return "Return/refund relationship matching is not available for this product yet.";
  if (!relationship.returnedUnits && !relationship.refundedUnits && !relationship.unattributedRefundAmount) {
    return "No return or refund events were matched in the stored analysis window.";
  }
  if (relationship.returnedAndRefundedUnits > 0) {
    return "Returns are leading to attributed refunds, so product friction is also creating confirmed financial loss.";
  }
  if (relationship.refundedWithoutReturnUnits > 0) {
    return "Refunds are happening without matching returns, which points to compensation or product-attributed refund leakage.";
  }
  if (relationship.returnedNotRefundedUnits > 0) {
    return "Returns exist without matching refunds, so the product is creating friction but not all cases are confirmed loss.";
  }
  if (relationship.unattributedRefundAmount > 0) {
    return "Some refund amount is unattributed, so it should lower confidence rather than directly blame this product.";
  }
  return "Return/refund relationship data is available and does not show unresolved financial loss.";
}

function getAiFinancialExposureInterpretation(exposure: AiFinancialExposureBreakdown): string {
  if (!exposure.available) return "Financial exposure relationship breakdown is not available yet.";
  if (exposure.confirmedRefundAmount > 0 && exposure.returnRelatedRiskAmount > 0) {
    return "Financial exposure separates confirmed refunds from potential return-related risk.";
  }
  if (exposure.confirmedRefundAmount > 0) return "Financial exposure is mostly confirmed refund loss.";
  if (exposure.returnRelatedRiskAmount > 0) return "Financial exposure is mostly potential return-related risk, not confirmed refund loss.";
  if (exposure.unattributedRefundAmount > 0) return "Unattributed refunds are present and should be treated as lower-confidence financial context.";
  return "No meaningful financial exposure is stored for this product.";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function truncate(value: string, maxLength: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(optionalText).filter((item): item is string => Boolean(item)))];
}

function buildFreshness(values: Array<string | null | undefined>): AiDataFreshness[] {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : NaN)
    .filter(Number.isFinite);
  const latest = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  return [{ source: "ProductPulse", updatedAt: latest }];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function safeCount(read: () => Promise<number>): Promise<number | null> {
  try {
    const value = await read();
    return Number.isFinite(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
}
