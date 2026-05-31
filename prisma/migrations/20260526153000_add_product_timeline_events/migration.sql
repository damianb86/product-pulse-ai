CREATE TABLE "ProductTimelineEvent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "handle" TEXT,
  "variantGid" TEXT,
  "eventType" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "severityTone" TEXT NOT NULL DEFAULT 'neutral',
  "importance" INTEGER NOT NULL DEFAULT 50,
  "confidence" INTEGER,
  "beforeValue" JSONB,
  "afterValue" JSONB,
  "metadata" JSONB,
  "dedupeKey" TEXT NOT NULL,
  "scanJobId" TEXT,
  "diagnosisId" TEXT,
  "watchActivityId" TEXT,
  "actionId" TEXT,
  "reviewId" TEXT,
  "returnId" TEXT,
  "refundId" TEXT,
  "orderId" TEXT,
  "shopifyEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductTimelineEvent_shop_productGid_dedupeKey_key" ON "ProductTimelineEvent"("shop", "productGid", "dedupeKey");
CREATE INDEX "ProductTimelineEvent_shop_productGid_occurredAt_idx" ON "ProductTimelineEvent"("shop", "productGid", "occurredAt");
CREATE INDEX "ProductTimelineEvent_shop_category_occurredAt_idx" ON "ProductTimelineEvent"("shop", "category", "occurredAt");
CREATE INDEX "ProductTimelineEvent_shop_eventType_occurredAt_idx" ON "ProductTimelineEvent"("shop", "eventType", "occurredAt");
CREATE INDEX "ProductTimelineEvent_shop_importance_occurredAt_idx" ON "ProductTimelineEvent"("shop", "importance", "occurredAt");
CREATE INDEX "ProductTimelineEvent_diagnosisId_idx" ON "ProductTimelineEvent"("diagnosisId");
CREATE INDEX "ProductTimelineEvent_watchActivityId_idx" ON "ProductTimelineEvent"("watchActivityId");
CREATE INDEX "ProductTimelineEvent_actionId_idx" ON "ProductTimelineEvent"("actionId");
