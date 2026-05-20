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
  AiProductRiskDetail,
  AiProductRiskSummary,
  AiRecentActivityItem,
  AiRecommendationSummary,
  AiSourceSummary,
  AiToolContext,
  AiWatchlistItemSummary,
  AiWatchlistSnapshot,
} from "../domain/types";

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
const WATCHLIST_MAX_PRODUCTS = 5;
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
  ): Promise<{ products: AiProductRiskSummary[]; totalCount: number; hasMore: boolean; freshness: AiDataFreshness[] }> {
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const settings = await this.getRiskSettings(context);
    const where = buildProductSnapshotWhere(context.shop, options.query, options.risk, settings);
    const orderBy = buildProductSnapshotOrderBy(options.sortBy, options.sortDirection);
    const fetchTake = Math.min(Math.max(limit * 2, limit + 1), 75);

    const [snapshots, totalCount] = await Promise.all([
      this.db.productRiskSnapshot.findMany({
        where,
        orderBy,
        skip: offset,
        take: fetchTake,
      }),
      safeCount(() => this.db.productRiskSnapshot.count({ where })),
    ]);

    const snapshotRows = snapshots as unknown as DbRecord[];
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
    };
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
      actionHistory: (actions as unknown as DbRecord[]).map(mapActionHistorySummary),
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
  };
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
    recommendations: arrayOfRecords(diagnosis.recommendations)
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
