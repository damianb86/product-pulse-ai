CREATE TABLE "ProductWatchlistItem" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "handle" TEXT,
  "sku" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Watching',
  "imageUrl" TEXT,
  "imageAlt" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductWatchlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductWatchlistItem_shop_productGid_key" ON "ProductWatchlistItem"("shop", "productGid");
CREATE INDEX "ProductWatchlistItem_shop_status_idx" ON "ProductWatchlistItem"("shop", "status");
CREATE INDEX "ProductWatchlistItem_shop_addedAt_idx" ON "ProductWatchlistItem"("shop", "addedAt");
