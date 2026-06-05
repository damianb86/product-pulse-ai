-- Speed up Products table page loads by supporting latest resolution actions
-- and the latest risk score history lookups used by the table trend sparkline.
CREATE INDEX IF NOT EXISTS "ProductAction_shop_status_actionType_productGid_appliedAt_createdAt_idx"
  ON "ProductAction"("shop", "status", "actionType", "productGid", "appliedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "ProductScoreHistory_shop_productGid_recordedAt_desc_idx"
  ON "ProductScoreHistory"("shop", "productGid", "recordedAt" DESC);
