ALTER TABLE "CatalogSignalJob"
  ADD COLUMN "leasedBy" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "notBefore" TIMESTAMP(3);

CREATE INDEX "CatalogSignalJob_kind_status_leaseExpiresAt_idx"
  ON "CatalogSignalJob"("kind", "status", "leaseExpiresAt");

CREATE INDEX "CatalogSignalJob_kind_status_priority_notBefore_startedAt_idx"
  ON "CatalogSignalJob"("kind", "status", "priority", "notBefore", "startedAt");
