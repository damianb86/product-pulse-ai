-- Shared per-shop Shopify source event cache for product diagnosis.
-- Stores compact line-level sales/refund/return events, not raw Shopify orders,
-- so multiple product diagnoses in the same shop can reuse the same source data.
CREATE TABLE IF NOT EXISTS "ProductPulseShopSourceEventCache" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "fetchComplete" BOOLEAN NOT NULL DEFAULT true,
  "fetchedThroughAt" TIMESTAMP(3),
  "sourceFetchComplete" JSONB,
  "counts" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductPulseShopSourceEventCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductPulseShopSourceEvent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "productGid" TEXT,
  "variantGid" TEXT,
  "orderGid" TEXT,
  "lineItemGid" TEXT,
  "eventAt" TIMESTAMP(3),
  "sourceUpdatedAt" TIMESTAMP(3),
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductPulseShopSourceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductPulseShopSourceEventCache_shop_cacheKey_key"
  ON "ProductPulseShopSourceEventCache"("shop", "cacheKey");
CREATE INDEX IF NOT EXISTS "ProductPulseShopSourceEventCache_shop_updatedAt_idx"
  ON "ProductPulseShopSourceEventCache"("shop", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductPulseShopSourceEvent_shop_sourceType_cacheKey_key"
  ON "ProductPulseShopSourceEvent"("shop", "sourceType", "cacheKey");
CREATE INDEX IF NOT EXISTS "ProductPulseShopSourceEvent_shop_sourceType_eventAt_idx"
  ON "ProductPulseShopSourceEvent"("shop", "sourceType", "eventAt");
CREATE INDEX IF NOT EXISTS "ProductPulseShopSourceEvent_shop_productGid_sourceType_eventAt_idx"
  ON "ProductPulseShopSourceEvent"("shop", "productGid", "sourceType", "eventAt");
CREATE INDEX IF NOT EXISTS "ProductPulseShopSourceEvent_shop_variantGid_sourceType_eventAt_idx"
  ON "ProductPulseShopSourceEvent"("shop", "variantGid", "sourceType", "eventAt");
CREATE INDEX IF NOT EXISTS "ProductPulseShopSourceEvent_shop_updatedAt_idx"
  ON "ProductPulseShopSourceEvent"("shop", "updatedAt");
