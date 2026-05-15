DROP INDEX IF EXISTS "ProductWatchlistItem_shop_displayOrder_idx";

ALTER TABLE "ProductWatchlistItem" DROP COLUMN IF EXISTS "displayOrder";
