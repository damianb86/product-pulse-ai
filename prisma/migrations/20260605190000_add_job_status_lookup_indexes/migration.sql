-- Keep the global job monitor and credits popover index-only friendly.
CREATE INDEX IF NOT EXISTS "CatalogSignalJob_shop_updatedAt_idx"
  ON "CatalogSignalJob"("shop", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "CatalogSignalJob_shop_status_updatedAt_idx"
  ON "CatalogSignalJob"("shop", "status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_shop_createdAt_id_idx"
  ON "CreditLedgerEntry"("shop", "createdAt" DESC, "id" DESC);
