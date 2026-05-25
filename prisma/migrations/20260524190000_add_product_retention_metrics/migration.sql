ALTER TABLE "ProductDiagnosis" ADD COLUMN "metrics" JSONB;

CREATE TABLE "ProductRetentionRun" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "asOfDate" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "windowStartDate" TIMESTAMP(3) NOT NULL,
  "windowEndDate" TIMESTAMP(3) NOT NULL,
  "lookbackDays" INTEGER NOT NULL,
  "maxCohortAgeDays" INTEGER NOT NULL,
  "currency" TEXT,
  "schemaVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRetentionDailyCohort" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "retentionRunId" TEXT NOT NULL,
  "cohortDate" TEXT NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "anyRepeatWithin7dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin14dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin30dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin60dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin180dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin7dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin14dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin30dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin60dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin180dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin7dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin14dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin30dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin60dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin180dCount" INTEGER NOT NULL DEFAULT 0,
  "nextPurchaseSameProductCount" INTEGER NOT NULL DEFAULT 0,
  "nextPurchaseOtherProductCount" INTEGER NOT NULL DEFAULT 0,
  "didNotReturnCount" INTEGER NOT NULL DEFAULT 0,
  "firstOrderNetRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "totalNetRevenueWithin30dCents" BIGINT NOT NULL DEFAULT 0,
  "totalNetRevenueWithin60dCents" BIGINT NOT NULL DEFAULT 0,
  "totalNetRevenueWithin90dCents" BIGINT NOT NULL DEFAULT 0,
  "totalNetRevenueWithin180dCents" BIGINT NOT NULL DEFAULT 0,
  "sameProductRevenueWithin90dCents" BIGINT NOT NULL DEFAULT 0,
  "otherProductRevenueWithin90dCents" BIGINT NOT NULL DEFAULT 0,
  "ltv30Cents" BIGINT NOT NULL DEFAULT 0,
  "ltv60Cents" BIGINT NOT NULL DEFAULT 0,
  "ltv90Cents" BIGINT NOT NULL DEFAULT 0,
  "ltv180Cents" BIGINT NOT NULL DEFAULT 0,
  "avgDaysToNextPurchase" DECIMAL(12,4),
  "medianDaysToNextPurchase" DECIMAL(12,4),
  "avgDaysToSameProductRepurchase" DECIMAL(12,4),
  "medianDaysToSameProductRepurchase" DECIMAL(12,4),
  "isMature7d" BOOLEAN NOT NULL DEFAULT false,
  "isMature14d" BOOLEAN NOT NULL DEFAULT false,
  "isMature30d" BOOLEAN NOT NULL DEFAULT false,
  "isMature60d" BOOLEAN NOT NULL DEFAULT false,
  "isMature90d" BOOLEAN NOT NULL DEFAULT false,
  "isMature180d" BOOLEAN NOT NULL DEFAULT false,
  "observedDays" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionDailyCohort_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRetentionCohortCell" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "retentionRunId" TEXT NOT NULL,
  "cohortDate" TEXT NOT NULL,
  "ageDay" INTEGER NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "anyRepeatCumulativeCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatCumulativeCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductCumulativeCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatRate" DECIMAL(18,6),
  "sameProductRepeatRate" DECIMAL(18,6),
  "boughtOtherProductRate" DECIMAL(18,6),
  "cumulativeNetRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "cumulativeLtvCents" BIGINT NOT NULL DEFAULT 0,
  "sameProductCumulativeRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "otherProductCumulativeRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "sameProductCumulativeLtvCents" BIGINT NOT NULL DEFAULT 0,
  "otherProductCumulativeLtvCents" BIGINT NOT NULL DEFAULT 0,
  "isObserved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionCohortCell_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRetentionDailyActivity" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "retentionRunId" TEXT NOT NULL,
  "metricDate" TEXT NOT NULL,
  "productOrdersCount" INTEGER NOT NULL DEFAULT 0,
  "productUnitsSold" INTEGER NOT NULL DEFAULT 0,
  "uniqueProductBuyers" INTEGER NOT NULL DEFAULT 0,
  "newProductBuyers" INTEGER NOT NULL DEFAULT 0,
  "returningProductBuyers" INTEGER NOT NULL DEFAULT 0,
  "productGrossRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "productNetRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "sameProductRepeatRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "postProductCustomerRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "otherProductRevenueFromProductCustomersCents" BIGINT NOT NULL DEFAULT 0,
  "customersBuyingProductAgainCount" INTEGER NOT NULL DEFAULT 0,
  "customersBuyingOtherProductAfterThisProductCount" INTEGER NOT NULL DEFAULT 0,
  "customersWithAnyRepeatOrderCount" INTEGER NOT NULL DEFAULT 0,
  "returningProductBuyerShare" DECIMAL(18,6),
  "sameProductRepurchaseShare" DECIMAL(18,6),
  "crossSellShare" DECIMAL(18,6),
  "returningRevenueShare" DECIMAL(18,6),
  "refundedOrdersCount" INTEGER NOT NULL DEFAULT 0,
  "refundedRevenueCents" BIGINT NOT NULL DEFAULT 0,
  "returnRate" DECIMAL(18,6),
  "refundRate" DECIMAL(18,6),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionDailyActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRetentionSegmentDaily" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "retentionRunId" TEXT NOT NULL,
  "cohortDate" TEXT NOT NULL,
  "segmentType" TEXT NOT NULL,
  "segmentValue" TEXT NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "anyRepeatWithin30dCount" INTEGER NOT NULL DEFAULT 0,
  "anyRepeatWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "sameProductRepeatWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "boughtOtherProductWithin90dCount" INTEGER NOT NULL DEFAULT 0,
  "netRevenueWithin90dCents" BIGINT NOT NULL DEFAULT 0,
  "ltv90Cents" BIGINT NOT NULL DEFAULT 0,
  "avgDaysToNextPurchase" DECIMAL(12,4),
  "medianDaysToNextPurchase" DECIMAL(12,4),
  "isMature90d" BOOLEAN NOT NULL DEFAULT false,
  "isLowSampleSize" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionSegmentDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRetentionSummary" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "retentionRunId" TEXT NOT NULL,
  "asOfDate" TIMESTAMP(3) NOT NULL,
  "repeatPurchaseRate90d" DECIMAL(18,6),
  "repeatPurchaseRate180d" DECIMAL(18,6),
  "sameProductRepurchaseRate90d" DECIMAL(18,6),
  "sameProductRepurchaseRate180d" DECIMAL(18,6),
  "crossSellRetentionRate90d" DECIMAL(18,6),
  "returningRevenueShare" DECIMAL(18,6),
  "avgDaysToSecondPurchase" DECIMAL(12,4),
  "medianDaysToSecondPurchase" DECIMAL(12,4),
  "productLtv90Cents" BIGINT NOT NULL DEFAULT 0,
  "productLtv180Cents" BIGINT NOT NULL DEFAULT 0,
  "retentionHealthScore" INTEGER,
  "repeatPurchaseRate90dPrevious" DECIMAL(18,6),
  "repeatPurchaseRate90dDelta" DECIMAL(18,6),
  "sameProductRepurchaseRate90dPrevious" DECIMAL(18,6),
  "sameProductRepurchaseRate90dDelta" DECIMAL(18,6),
  "ltv90PreviousCents" BIGINT,
  "ltv90DeltaCents" BIGINT,
  "returningRevenueSharePrevious" DECIMAL(18,6),
  "returningRevenueShareDelta" DECIMAL(18,6),
  "totalCustomersAnalyzed" INTEGER NOT NULL DEFAULT 0,
  "totalOrdersAnalyzed" INTEGER NOT NULL DEFAULT 0,
  "totalProductOrdersAnalyzed" INTEGER NOT NULL DEFAULT 0,
  "earliestOrderDate" TIMESTAMP(3),
  "latestOrderDate" TIMESTAMP(3),
  "hasEnoughData" BOOLEAN NOT NULL DEFAULT false,
  "lowSampleWarning" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductRetentionSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductRetentionRun_shopId_productGid_diagnosisId_key" ON "ProductRetentionRun"("shopId", "productGid", "diagnosisId");
CREATE INDEX "ProductRetentionRun_shopId_productGid_asOfDate_idx" ON "ProductRetentionRun"("shopId", "productGid", "asOfDate");
CREATE INDEX "ProductRetentionRun_diagnosisId_idx" ON "ProductRetentionRun"("diagnosisId");

CREATE UNIQUE INDEX "ProductRetentionDailyCohort_shopId_productGid_diagnosisId_cohortDate_key" ON "ProductRetentionDailyCohort"("shopId", "productGid", "diagnosisId", "cohortDate");
CREATE INDEX "ProductRetentionDailyCohort_retentionRunId_idx" ON "ProductRetentionDailyCohort"("retentionRunId");
CREATE INDEX "ProductRetentionDailyCohort_shopId_productGid_cohortDate_idx" ON "ProductRetentionDailyCohort"("shopId", "productGid", "cohortDate");

CREATE UNIQUE INDEX "ProductRetentionCohortCell_shopId_productGid_diagnosisId_cohortDate_ageDay_key" ON "ProductRetentionCohortCell"("shopId", "productGid", "diagnosisId", "cohortDate", "ageDay");
CREATE INDEX "ProductRetentionCohortCell_retentionRunId_idx" ON "ProductRetentionCohortCell"("retentionRunId");
CREATE INDEX "ProductRetentionCohortCell_shopId_productGid_cohortDate_idx" ON "ProductRetentionCohortCell"("shopId", "productGid", "cohortDate");

CREATE UNIQUE INDEX "ProductRetentionDailyActivity_shopId_productGid_diagnosisId_metricDate_key" ON "ProductRetentionDailyActivity"("shopId", "productGid", "diagnosisId", "metricDate");
CREATE INDEX "ProductRetentionDailyActivity_retentionRunId_idx" ON "ProductRetentionDailyActivity"("retentionRunId");
CREATE INDEX "ProductRetentionDailyActivity_shopId_productGid_metricDate_idx" ON "ProductRetentionDailyActivity"("shopId", "productGid", "metricDate");

CREATE UNIQUE INDEX "ProductRetentionSegmentDaily_shopId_productGid_diagnosisId_cohortDate_segmentType_segmentValue_key" ON "ProductRetentionSegmentDaily"("shopId", "productGid", "diagnosisId", "cohortDate", "segmentType", "segmentValue");
CREATE INDEX "ProductRetentionSegmentDaily_retentionRunId_idx" ON "ProductRetentionSegmentDaily"("retentionRunId");
CREATE INDEX "ProductRetentionSegmentDaily_shopId_productGid_segmentType_segmentValue_idx" ON "ProductRetentionSegmentDaily"("shopId", "productGid", "segmentType", "segmentValue");

CREATE UNIQUE INDEX "ProductRetentionSummary_shopId_productGid_diagnosisId_key" ON "ProductRetentionSummary"("shopId", "productGid", "diagnosisId");
CREATE INDEX "ProductRetentionSummary_retentionRunId_idx" ON "ProductRetentionSummary"("retentionRunId");
CREATE INDEX "ProductRetentionSummary_shopId_productGid_asOfDate_idx" ON "ProductRetentionSummary"("shopId", "productGid", "asOfDate");
