CREATE TABLE "ProductWatchActivity" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT,
  "productTitle" TEXT,
  "watchlistItemId" TEXT,
  "eventType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductWatchActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductScoreHistory" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "handle" TEXT,
  "source" TEXT NOT NULL,
  "riskScore" INTEGER NOT NULL,
  "impactScore" INTEGER,
  "confidence" INTEGER,
  "primaryIssue" TEXT,
  "metrics" JSONB,
  "snapshotId" TEXT,
  "diagnosisId" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductScoreHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductWatchActivity_shop_createdAt_idx" ON "ProductWatchActivity"("shop", "createdAt");
CREATE INDEX "ProductWatchActivity_shop_productGid_createdAt_idx" ON "ProductWatchActivity"("shop", "productGid", "createdAt");
CREATE INDEX "ProductWatchActivity_shop_eventType_idx" ON "ProductWatchActivity"("shop", "eventType");
CREATE INDEX "ProductScoreHistory_shop_productGid_recordedAt_idx" ON "ProductScoreHistory"("shop", "productGid", "recordedAt");
CREATE INDEX "ProductScoreHistory_shop_recordedAt_idx" ON "ProductScoreHistory"("shop", "recordedAt");
CREATE INDEX "ProductScoreHistory_shop_source_idx" ON "ProductScoreHistory"("shop", "source");
