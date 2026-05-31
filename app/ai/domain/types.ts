import type { z } from "zod";

export type AiPermissionLevel = "merchant";

export type AiToolCategory =
  | "products"
  | "diagnosis"
  | "evidence"
  | "analytics"
  | "watchlist"
  | "app_knowledge";

export interface AiToolContext {
  shop: string;
  userId?: string | number | null;
  sessionId?: string | null;
  scopes?: string[];
  requestId?: string;
  conversationId?: string;
  createdAt: string;
}

export interface AiDataFreshness {
  source: string;
  updatedAt: string | null;
}

export interface AiToolResultMetadata {
  resultCount?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  dataFreshness?: AiDataFreshness[];
  warnings?: string[];
}

export interface AiToolResult<TData = unknown> {
  data: TData;
  metadata?: AiToolResultMetadata;
}

export interface AiToolSafeError {
  code: string;
  message: string;
  retryable?: boolean;
  validationIssues?: Array<{
    path: string;
    message: string;
  }>;
}

export type AiToolExecutionResult<TData = unknown> =
  | {
      ok: true;
      toolName: string;
      data: TData;
      metadata: AiToolResultMetadata;
    }
  | {
      ok: false;
      toolName: string;
      error: AiToolSafeError;
      metadata: AiToolResultMetadata;
    };

export interface AiToolDefinition<TInput = unknown, TData = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (context: AiToolContext, input: TInput) => Promise<AiToolResult<TData>>;
  readOnly: true;
  category: AiToolCategory;
  permissionLevel: AiPermissionLevel;
  metadata?: {
    resultType?: string;
    dataSources?: string[];
    maxResultCount?: number;
    providerAgnostic?: true;
  };
}

export type AnyAiToolDefinition = AiToolDefinition<unknown, unknown>;

export interface AiProductMetricSummary {
  returnRate: number | null;
  refundRate: number | null;
  reviewRating: number | null;
  reviewCount: number | null;
  negativeReviewCount: number | null;
  signalCount: number | null;
  soldUnits: number | null;
  returnUnits: number | null;
  refundUnits: number | null;
  estimatedImpact: number | null;
  revenueAtRisk: number | null;
  marginAtRisk: number | null;
  productMomentumScore: number | null;
  productMomentumTier: string | null;
  returnRefundRelationship: AiReturnRefundRelationshipSummary | null;
  financialExposureBreakdown: AiFinancialExposureBreakdown | null;
  purchaseContext: AiProductPurchaseContextSummary | null;
  productRelationshipIntelligence: AiProductRelationshipSummary | null;
  productRelationshipInsights: AiProductRelationshipInsights | null;
}

export interface AiReturnRefundRelationshipSummary {
  available: boolean;
  status: string;
  soldUnits: number;
  soldOrders: number;
  returnedUnits: number;
  returnedOrders: number;
  refundedUnits: number;
  refundedOrders: number;
  returnedAndRefundedUnits: number;
  returnedNotRefundedUnits: number;
  refundedWithoutReturnUnits: number;
  exchangeOrReplacementUnits: number;
  pendingOrUnknownCount: number;
  unattributedRefundAmount: number;
  attributedRefundAmount: number;
  refundAmountWithReturn: number;
  refundAmountWithoutReturn: number;
  totalProductRevenue: number;
  returnRateUnits: number;
  returnToRefundRate: number;
  refundWithoutReturnRate: number;
  refundRateRevenue: number;
  refundAttributionRate: number;
  relationshipMatchConfidenceAvg: number;
  attributionConfidence: "High" | "Medium" | "Low" | "Unavailable";
  interpretation: string;
}

export interface AiReturnRefundResolutionSummary {
  productGid: string;
  title: string;
  handle: string | null;
  available: boolean;
  status: string;
  matrix: {
    returnYesRefundYes: number;
    returnYesRefundNo: number;
    returnNoRefundYes: number;
  };
  buckets: {
    returnAndRefund: number;
    returnOnly: number;
    refundOnly: number;
    exchangeOrReplacement: number;
    pendingOrUnknown: number;
    unattributedRefundAmount: number;
  };
  rates: {
    returnedUnitsRefunded: number;
    refundsWithoutReturn: number;
    refundAttribution: number;
  };
  attributionConfidence: "High" | "Medium" | "Low" | "Unavailable";
  interpretation: string;
}

export interface AiFinancialExposureBreakdown {
  available: boolean;
  estimatedExposure: number;
  confirmedRefundAmount: number;
  attributedRefundAmount: number;
  refundAmountWithReturn: number;
  refundAmountWithoutReturn: number;
  unattributedRefundAmount: number;
  returnRelatedRiskAmount: number;
  estimatedFutureRefundFromReturnOnlyCases: number;
  refundAttributionRate: number;
  interpretation: string;
}

export interface AiPurchaseQuantityDistribution {
  oneUnitCount: number;
  twoUnitCount: number;
  threeUnitCount: number;
  fourPlusUnitCount: number;
  oneUnitRate: number;
  twoUnitRate: number;
  threeUnitRate: number;
  fourPlusUnitRate: number;
}

export interface AiCoPurchasedProductSummary {
  productId: string | null;
  title: string;
  handle: string | null;
  coOrderCount: number;
  coOrderRate: number;
  affinityScore: number | null;
}

export interface AiProductPurchaseContextSummary {
  available: boolean;
  status: string;
  productGid: string | null;
  title: string | null;
  handle: string | null;
  totalOrdersContainingProduct: number;
  totalUnitsSold: number;
  totalRevenueIfAvailable: number;
  soloProductOrderCount: number;
  multiProductOrderCount: number;
  singleUnitOrderCount: number;
  multiUnitOrderCount: number;
  bulkOrderCount: number;
  multiVariantOrderCount: number;
  avgProductQuantityPerOrder: number;
  avgDistinctProductsPerOrder: number;
  soloPurchaseRate: number;
  multiProductBasketRate: number;
  singleUnitPurchaseRate: number;
  multiUnitPurchaseRate: number;
  bulkPurchaseRate: number;
  multiVariantOrderRate: number;
  purchaseContextConfidence: number;
  purchaseContextConfidenceLabel: "High" | "Medium" | "Low" | "Unavailable";
  unknownOrIncompleteOrderCount: number;
  quantityDistribution: AiPurchaseQuantityDistribution;
  topCoPurchasedProducts: AiCoPurchasedProductSummary[];
  interpretation: string;
}

export interface AiProductPurchaseContextRiskImpact {
  available: boolean;
  riskImpact: string;
  confidenceImpact: string;
  financialExposureImpact: string;
  returnPressureImpact: string;
  refundLeakageImpact: string;
  explanations: string[];
}

export interface AiProductRelationshipItem {
  relatedProductId: string | null;
  title: string;
  handle: string | null;
  relationshipType: string;
  direction: "together" | "before" | "after" | string;
  timeWindow: string;
  relationshipRate: number;
  attachRate: number;
  lift: number | null;
  confidence: number;
  confidenceLabel: "High" | "Medium" | "Low" | "Unavailable" | string;
  sampleSize: number;
  relationshipStrength: string;
  trend: string;
  deltaReturnRate: number;
  deltaRefundRate: number;
}

export interface AiProductRelationshipSummary {
  available: boolean;
  status: string;
  productGid: string | null;
  title: string | null;
  handle: string | null;
  confidenceScore: number;
  confidenceLabel: "High" | "Medium" | "Low" | "Unavailable" | string;
  orderCount: number;
  customerCount: number;
  topBoughtTogether: AiProductRelationshipItem[];
  topBoughtBefore: AiProductRelationshipItem[];
  topBoughtAfter: AiProductRelationshipItem[];
  strongestRelationships: AiProductRelationshipItem[];
  emergingRelationships: AiProductRelationshipItem[];
  relationshipsWithReturnRiskImpact: AiProductRelationshipItem[];
  relationshipsWithCrossSellOpportunity: AiProductRelationshipItem[];
  warnings: string[];
  interpretation: string;
}

export interface AiProductRelationshipRiskImpact {
  available: boolean;
  riskImpact: string;
  confidenceImpact: string;
  opportunityImpact: string;
  explanations: string[];
}

export interface AiProductRelationshipInsights {
  available: boolean;
  status: string;
  insightVersion: string | null;
  generatedAt: string | null;
  model: string | null;
  insights: Array<{
    id: string;
    type: string;
    sourceRelationshipId: string;
    relatedProductTitle: string;
    summary: string;
    recommendation: string;
    caveat: string;
    metrics: Record<string, string | number | boolean | null>;
  }>;
  deterministicInputs: {
    relationshipCount: number;
    confidenceScore: number;
    warnings: string[];
  };
}

export interface AiProductRiskSummary {
  productGid: string;
  title: string;
  handle: string | null;
  riskScore: number;
  riskLabel: string;
  impactScore: number | null;
  confidence: number | null;
  primaryIssue: string | null;
  analysisDepth: "none" | "quickscan" | "full";
  latestDiagnosisId: string | null;
  sourceCoverage: string[];
  metrics: AiProductMetricSummary;
  isWatched: boolean;
  watchlistStatus: string | null;
  calculatedAt: string | null;
  updatedAt: string | null;
}

export interface AiIssueSummary {
  issue: string;
  issueCode: string | null;
  severity: string | null;
  confidence: number | null;
  signals: number | null;
  sourceTypes: string[];
  evidence: string[];
  suggestedAction: string | null;
}

export interface AiEvidenceSnippet {
  id: string;
  productGid: string;
  source: string;
  quote: string;
  weight: string | null;
  points: string[];
  referenceType: "diagnosis" | "snapshot" | "action" | "watchlist";
  referenceId: string | null;
}

export interface AiRecommendationSummary {
  id: string;
  label: string;
  type: string | null;
  status: string | null;
  effort: string | null;
  issue: string | null;
  draftPreview: string | null;
  payloadSummary: Record<string, string | number | boolean | null>;
}

export interface AiActionHistorySummary {
  id: string;
  actionType: string;
  label: string;
  status: string;
  createdAt: string | null;
  appliedAt: string | null;
  payloadSummary: Record<string, string | number | boolean | null>;
}

export interface AiDiagnosisSummary {
  id: string;
  status: string;
  riskScore: number | null;
  confidence: number | null;
  likelyCause: string | null;
  completedAt: string | null;
  createdAt: string | null;
  issues: AiIssueSummary[];
  evidence: AiEvidenceSnippet[];
  recommendations: AiRecommendationSummary[];
}

export interface AiRiskHistoryPoint {
  riskScore: number;
  impactScore: number | null;
  confidence: number | null;
  source: string;
  primaryIssue: string | null;
  recordedAt: string | null;
}

export interface AiProductRiskDetail extends AiProductRiskSummary {
  diagnosis: AiDiagnosisSummary | null;
  actionHistory: AiActionHistorySummary[];
  riskHistory: AiRiskHistoryPoint[];
  mainFinding: {
    title: string | null;
    detail: string | null;
    summary: string | null;
  } | null;
}

export interface AiSourceSummary {
  sourceKey: string;
  category: string;
  name: string;
  connected: boolean;
  active: boolean;
  available: boolean;
  health: string;
  coverageWeight: number;
  lastSyncedAt: string | null;
  connectedAt: string | null;
}

export interface AiAnalyticsSnapshot {
  productCount: number;
  sampledProductCount: number;
  sampled: boolean;
  averageRiskScore: number | null;
  averageConfidence: number | null;
  riskDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  topIssues: Array<{
    issue: string;
    count: number;
    highestRiskScore: number;
  }>;
  sourceCoverage: AiSourceSummary[];
  recentDiagnosisCount: number;
  openRecommendationCount: number;
  appliedActionCount: number;
}

export interface AiWatchlistItemSummary {
  id: string;
  productGid: string;
  title: string;
  handle: string | null;
  sku: string | null;
  status: string;
  riskScore: number | null;
  riskLabel: string | null;
  primaryIssue: string | null;
  lastUpdatedAt: string | null;
  addedAt: string | null;
}

export interface AiRecentActivityItem {
  id: string;
  eventType: string;
  title: string;
  detail: string | null;
  productGid: string | null;
  productTitle: string | null;
  riskScore: number | null;
  riskLabel: string | null;
  createdAt: string | null;
}

export interface AiWatchlistSnapshot {
  maxProducts: number;
  watchedCount: number;
  slotsAvailable: number;
  alertsEnabled: boolean;
  alertRecipientCount: number;
  scanCadenceDays: number;
  triggerRule: string;
  summarySchedule: string;
  items: AiWatchlistItemSummary[];
  recentActivity: AiRecentActivityItem[];
}
