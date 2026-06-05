-- Materialized per-product rollup used by Dashboard, Analytics and Products
-- so request-time reads do not repeatedly parse the heavy ProductRiskSnapshot.metrics JSON.
CREATE TABLE IF NOT EXISTS "ProductPulseProductRollup" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "handle" TEXT,
  "imageUrl" TEXT,
  "imageAlt" TEXT,
  "vendor" TEXT,
  "productType" TEXT,
  "primaryCollection" TEXT,
  "collections" JSONB,
  "tags" JSONB,
  "sku" TEXT,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "impactScore" INTEGER NOT NULL DEFAULT 0,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "primaryIssue" TEXT,
  "sourceCoverage" JSONB,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "signalCount" INTEGER NOT NULL DEFAULT 0,
  "analysisDepth" TEXT NOT NULL DEFAULT 'quickscan',
  "latestDiagnosisId" TEXT,
  "latestDiagnosisAt" TIMESTAMP(3),
  "isResolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "isWatched" BOOLEAN NOT NULL DEFAULT false,
  "watchlistStatus" TEXT,
  "reviewRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "negativeReviewCount" INTEGER NOT NULL DEFAULT 0,
  "negativeReviewRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recentNegativeReviewCount" INTEGER NOT NULL DEFAULT 0,
  "revenueAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estimatedImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salesAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgUnitRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marginRate" DOUBLE PRECISION,
  "returnRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refundRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "returnUnits" INTEGER NOT NULL DEFAULT 0,
  "refundUnits" INTEGER NOT NULL DEFAULT 0,
  "recentSignalUnits" INTEGER NOT NULL DEFAULT 0,
  "windowDays" INTEGER NOT NULL DEFAULT 60,
  "soldUnits" INTEGER NOT NULL DEFAULT 0,
  "soldOrders" INTEGER NOT NULL DEFAULT 0,
  "storeAvgReturnRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "storeAvgRefundRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastSignalAt" TIMESTAMP(3),
  "customerTextSignals" INTEGER NOT NULL DEFAULT 0,
  "contentIssueCount" INTEGER NOT NULL DEFAULT 0,
  "descriptionWordCount" INTEGER NOT NULL DEFAULT 0,
  "csvReviewCount" INTEGER NOT NULL DEFAULT 0,
  "csvReviewRatingCount" INTEGER NOT NULL DEFAULT 0,
  "csvNegativeReviewCount" INTEGER NOT NULL DEFAULT 0,
  "csvAverageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "judgeMeReviewCount" INTEGER NOT NULL DEFAULT 0,
  "judgeMeNegativeReviewCount" INTEGER NOT NULL DEFAULT 0,
  "judgeMeAverageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "yotpoReviewCount" INTEGER NOT NULL DEFAULT 0,
  "looxReviewCount" INTEGER NOT NULL DEFAULT 0,
  "productMomentumScore" INTEGER,
  "productMomentumTier" TEXT,
  "momentumDirection" TEXT,
  "momentumConfidence" INTEGER,
  "momentumConfidenceLabel" TEXT,
  "signalTrend" JSONB,
  "riskTrend" JSONB,
  "topReturnReasons" JSONB,
  "affectedVariants" JSONB,
  "impactFactors" JSONB,
  "estimatedImpactFactors" JSONB,
  "searchText" TEXT,
  "snapshotUpdatedAt" TIMESTAMP(3),
  "calculatedAt" TIMESTAMP(3),
  "rollupVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductPulseProductRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_productGid_key"
  ON "ProductPulseProductRollup"("shop", "productGid");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_riskScore_snapshotUpdatedAt_idx"
  ON "ProductPulseProductRollup"("shop", "riskScore", "snapshotUpdatedAt");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_analysisDepth_riskScore_idx"
  ON "ProductPulseProductRollup"("shop", "analysisDepth", "riskScore");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_isResolved_riskScore_idx"
  ON "ProductPulseProductRollup"("shop", "isResolved", "riskScore");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_isWatched_riskScore_idx"
  ON "ProductPulseProductRollup"("shop", "isWatched", "riskScore");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_vendor_idx"
  ON "ProductPulseProductRollup"("shop", "vendor");
CREATE INDEX IF NOT EXISTS "ProductPulseProductRollup_shop_productType_idx"
  ON "ProductPulseProductRollup"("shop", "productType");

CREATE OR REPLACE FUNCTION "_product_pulse_jsonb_float"(item JSONB)
RETURNS DOUBLE PRECISION
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN item IS NULL OR item = 'null'::jsonb THEN NULL
    WHEN jsonb_typeof(item) = 'number' THEN (item #>> '{}')::DOUBLE PRECISION
    WHEN jsonb_typeof(item) = 'string' AND (item #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (item #>> '{}')::DOUBLE PRECISION
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION "_product_pulse_jsonb_int"(item JSONB)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN "_product_pulse_jsonb_float"(item) IS NULL THEN NULL
    ELSE ROUND("_product_pulse_jsonb_float"(item))::INTEGER
  END
$$;

CREATE OR REPLACE FUNCTION "_product_pulse_jsonb_timestamp"(item JSONB)
RETURNS TIMESTAMP
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN item IS NULL OR item = 'null'::jsonb THEN NULL
    WHEN jsonb_typeof(item) = 'string' AND (item #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (item #>> '{}')::TIMESTAMP
    ELSE NULL
  END
$$;

INSERT INTO "ProductPulseProductRollup" (
  "id",
  "shop",
  "productGid",
  "productTitle",
  "handle",
  "imageUrl",
  "imageAlt",
  "vendor",
  "productType",
  "primaryCollection",
  "collections",
  "tags",
  "sku",
  "riskScore",
  "impactScore",
  "confidence",
  "primaryIssue",
  "sourceCoverage",
  "sourceCount",
  "signalCount",
  "analysisDepth",
  "latestDiagnosisId",
  "latestDiagnosisAt",
  "isResolved",
  "resolvedAt",
  "isWatched",
  "watchlistStatus",
  "reviewRating",
  "avgRating",
  "reviewCount",
  "negativeReviewCount",
  "negativeReviewRate",
  "recentNegativeReviewCount",
  "revenueAtRisk",
  "marginAtRisk",
  "estimatedImpact",
  "salesAmount",
  "refundAmount",
  "avgUnitRevenue",
  "marginRate",
  "returnRate",
  "refundRate",
  "returnUnits",
  "refundUnits",
  "recentSignalUnits",
  "windowDays",
  "soldUnits",
  "soldOrders",
  "storeAvgReturnRate",
  "storeAvgRefundRate",
  "lastSignalAt",
  "customerTextSignals",
  "contentIssueCount",
  "descriptionWordCount",
  "csvReviewCount",
  "csvReviewRatingCount",
  "csvNegativeReviewCount",
  "csvAverageRating",
  "judgeMeReviewCount",
  "judgeMeNegativeReviewCount",
  "judgeMeAverageRating",
  "yotpoReviewCount",
  "looxReviewCount",
  "productMomentumScore",
  "productMomentumTier",
  "momentumDirection",
  "momentumConfidence",
  "momentumConfidenceLabel",
  "signalTrend",
  "riskTrend",
  "topReturnReasons",
  "affectedVariants",
  "impactFactors",
  "estimatedImpactFactors",
  "searchText",
  "snapshotUpdatedAt",
  "calculatedAt",
  "rollupVersion",
  "createdAt",
  "updatedAt"
)
WITH snapshot_rows AS (
  SELECT
    snapshot.*,
    snapshot.metrics::jsonb AS metrics_json,
    snapshot."sourceCoverage"::jsonb AS source_coverage_json
  FROM "ProductRiskSnapshot" snapshot
),
latest_diagnosis AS (
  SELECT DISTINCT ON ("shop", "productGid")
    "shop",
    "productGid",
    "id",
    "completedAt",
    "createdAt"
  FROM "ProductDiagnosis"
  WHERE status = 'Completed'
  ORDER BY "shop", "productGid", "completedAt" DESC NULLS LAST, "createdAt" DESC
),
latest_resolution_action AS (
  SELECT DISTINCT ON ("shop", "productGid")
    "shop",
    "productGid",
    "actionType",
    "createdAt",
    "appliedAt"
  FROM "ProductAction"
  WHERE status = 'applied'
    AND "actionType" IN ('mark-resolved', 'mark-unresolved')
  ORDER BY "shop", "productGid", "appliedAt" DESC NULLS LAST, "createdAt" DESC
),
watchlist AS (
  SELECT
    "shop",
    "productGid",
    "status"
  FROM "ProductWatchlistItem"
)
SELECT
  snapshot.id,
  snapshot.shop,
  snapshot."productGid",
  snapshot."productTitle",
  NULLIF(snapshot.handle, ''),
  COALESCE(
    snapshot.metrics_json ->> 'imageUrl',
    snapshot.metrics_json ->> 'productImageUrl',
    snapshot.metrics_json ->> 'featuredImageUrl',
    snapshot.metrics_json #>> '{image,url}',
    snapshot.metrics_json #>> '{featuredImage,url}'
  ),
  COALESCE(
    snapshot.metrics_json ->> 'imageAlt',
    snapshot.metrics_json ->> 'productImageAlt',
    snapshot.metrics_json ->> 'featuredImageAlt',
    snapshot.metrics_json #>> '{image,altText}',
    snapshot.metrics_json #>> '{featuredImage,altText}'
  ),
  NULLIF(snapshot.metrics_json ->> 'vendor', ''),
  NULLIF(snapshot.metrics_json ->> 'productType', ''),
  COALESCE(snapshot.metrics_json #>> '{collections,0}', NULLIF(snapshot.metrics_json ->> 'productType', '')),
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'collections') = 'array' THEN snapshot.metrics_json -> 'collections' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'tags') = 'array' THEN snapshot.metrics_json -> 'tags' ELSE '[]'::jsonb END,
  NULLIF(snapshot.metrics_json ->> 'sku', ''),
  snapshot."riskScore",
  snapshot."impactScore",
  snapshot.confidence,
  NULLIF(snapshot."primaryIssue", ''),
  CASE WHEN jsonb_typeof(snapshot.source_coverage_json) = 'array' THEN snapshot.source_coverage_json ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.source_coverage_json) = 'array' THEN jsonb_array_length(snapshot.source_coverage_json) ELSE 0 END,
  COALESCE(
    "_product_pulse_jsonb_int"(snapshot.metrics_json -> 'signalCount'),
    "_product_pulse_jsonb_int"(snapshot.metrics_json -> 'signalsCount'),
    "_product_pulse_jsonb_int"(snapshot.metrics_json -> 'issueCount'),
    0
  ),
  CASE
    WHEN latest_diagnosis.id IS NOT NULL
      OR NULLIF(snapshot.metrics_json ->> 'latestDiagnosisId', '') IS NOT NULL
      OR "_product_pulse_jsonb_timestamp"(snapshot.metrics_json -> 'lastDetailedDiagnosisAt') IS NOT NULL
    THEN 'full'
    ELSE 'quickscan'
  END,
  COALESCE(latest_diagnosis.id, NULLIF(snapshot.metrics_json ->> 'latestDiagnosisId', '')),
  COALESCE(latest_diagnosis."completedAt", "_product_pulse_jsonb_timestamp"(snapshot.metrics_json -> 'lastDetailedDiagnosisAt')),
  COALESCE(latest_resolution_action."actionType" = 'mark-resolved', false),
  CASE WHEN latest_resolution_action."actionType" = 'mark-resolved' THEN COALESCE(latest_resolution_action."appliedAt", latest_resolution_action."createdAt") ELSE NULL END,
  watchlist."productGid" IS NOT NULL,
  watchlist.status,
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'reviewRating'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'avgRating'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'avgRating'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'reviewRating'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'csvAverageRating'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'reviewCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'negativeReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'negativeReviewRate'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'recentNegativeReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'revenueAtRisk'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'estimatedImpact'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'refundAmount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'marginAtRisk'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'revenueAtRisk') * 0.45, 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'estimatedImpact'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'revenueAtRisk'), "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'refundAmount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'salesAmount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'refundAmount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'avgUnitRevenue'), 0),
  "_product_pulse_jsonb_float"(snapshot.metrics_json -> 'marginRate'),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'returnRate'), "_product_pulse_jsonb_float"(snapshot.metrics_json #> '{monthlyOrderActivity,summary,returnRate}'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'refundRate'), "_product_pulse_jsonb_float"(snapshot.metrics_json #> '{monthlyOrderActivity,summary,refundRate}'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'returnUnits'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'refundUnits'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'recentSignalUnits'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'windowDays'), 60),
  GREATEST(
    COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'soldUnits'), 0),
    COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json #> '{monthlyOrderActivity,summary,totalOrderUnits}'), 0),
    COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'returnUnits'), 0),
    COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'refundUnits'), 0)
  ),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'soldOrders'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'storeAvgReturnRate'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'storeAvgRefundRate'), 0),
  "_product_pulse_jsonb_timestamp"(snapshot.metrics_json -> 'lastSignalAt'),
  COALESCE(
    "_product_pulse_jsonb_int"(snapshot.metrics_json -> 'customerTextSignals'),
    "_product_pulse_jsonb_int"(snapshot.metrics_json #> '{textInsights,sentiment,total}'),
    0
  ),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'contentIssueCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'descriptionWordCount'), "_product_pulse_jsonb_int"(snapshot.metrics_json -> 'descriptionWords'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'csvReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'csvReviewRatingCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'csvNegativeReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'csvAverageRating'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'judgeMeReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'judgeMeNegativeReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_float"(snapshot.metrics_json -> 'judgeMeAverageRating'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'yotpoReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'looxReviewCount'), 0),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'productMomentumScore'), "_product_pulse_jsonb_int"(snapshot.metrics_json #> '{productMomentum,score}')),
  COALESCE(NULLIF(snapshot.metrics_json ->> 'productMomentumTier', ''), NULLIF(snapshot.metrics_json #>> '{productMomentum,tier}', '')),
  COALESCE(NULLIF(snapshot.metrics_json ->> 'momentumDirection', ''), NULLIF(snapshot.metrics_json #>> '{productMomentum,direction}', '')),
  COALESCE("_product_pulse_jsonb_int"(snapshot.metrics_json -> 'momentumConfidence'), "_product_pulse_jsonb_int"(snapshot.metrics_json #> '{productMomentum,confidence}')),
  COALESCE(NULLIF(snapshot.metrics_json ->> 'momentumConfidenceLabel', ''), NULLIF(snapshot.metrics_json #>> '{productMomentum,confidenceLabel}', '')),
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'signalTrend') = 'array' THEN snapshot.metrics_json -> 'signalTrend' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'riskTrend') = 'array' THEN snapshot.metrics_json -> 'riskTrend' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'topReturnReasons') = 'array' THEN snapshot.metrics_json -> 'topReturnReasons' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'affectedVariants') = 'array' THEN snapshot.metrics_json -> 'affectedVariants' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'impactFactors') = 'object' THEN snapshot.metrics_json -> 'impactFactors' ELSE NULL END,
  CASE WHEN jsonb_typeof(snapshot.metrics_json -> 'estimatedImpactFactors') = 'object' THEN snapshot.metrics_json -> 'estimatedImpactFactors' ELSE NULL END,
  LOWER(CONCAT_WS(
    ' ',
    snapshot."productTitle",
    snapshot.handle,
    snapshot."primaryIssue",
    snapshot.metrics_json ->> 'vendor',
    snapshot.metrics_json ->> 'productType',
    snapshot.metrics_json ->> 'tags',
    snapshot.metrics_json ->> 'collections',
    snapshot.source_coverage_json::text
  )),
  snapshot."updatedAt",
  snapshot."calculatedAt",
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM snapshot_rows snapshot
LEFT JOIN latest_diagnosis
  ON latest_diagnosis.shop = snapshot.shop
  AND latest_diagnosis."productGid" = snapshot."productGid"
LEFT JOIN latest_resolution_action
  ON latest_resolution_action.shop = snapshot.shop
  AND latest_resolution_action."productGid" = snapshot."productGid"
LEFT JOIN watchlist
  ON watchlist.shop = snapshot.shop
  AND watchlist."productGid" = snapshot."productGid"
ON CONFLICT ("shop", "productGid") DO NOTHING;

DROP FUNCTION IF EXISTS "_product_pulse_jsonb_timestamp"(JSONB);
DROP FUNCTION IF EXISTS "_product_pulse_jsonb_int"(JSONB);
DROP FUNCTION IF EXISTS "_product_pulse_jsonb_float"(JSONB);
