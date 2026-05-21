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
