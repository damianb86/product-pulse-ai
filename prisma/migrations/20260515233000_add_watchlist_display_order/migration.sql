ALTER TABLE "ProductWatchlistItem" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked_watchlist AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "shop" ORDER BY "addedAt" ASC, "id" ASC) - 1 AS "rank"
  FROM "ProductWatchlistItem"
)
UPDATE "ProductWatchlistItem"
SET "displayOrder" = ranked_watchlist."rank"
FROM ranked_watchlist
WHERE "ProductWatchlistItem"."id" = ranked_watchlist."id";

CREATE INDEX "ProductWatchlistItem_shop_displayOrder_idx" ON "ProductWatchlistItem"("shop", "displayOrder");
