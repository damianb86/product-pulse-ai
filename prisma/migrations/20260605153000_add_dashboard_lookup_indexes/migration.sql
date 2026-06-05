-- Speed up dashboard/products list reads by making latest diagnosis lookups and
-- risk-ordered snapshot reads indexable.
CREATE INDEX IF NOT EXISTS "ProductRiskSnapshot_shop_riskScore_updatedAt_idx"
  ON "ProductRiskSnapshot"("shop", "riskScore", "updatedAt");

CREATE INDEX IF NOT EXISTS "ProductDiagnosis_shop_status_productGid_completedAt_createdAt_idx"
  ON "ProductDiagnosis"("shop", "status", "productGid", "completedAt", "createdAt");
