CREATE TABLE "ProductPulseSchedulerLock" (
  "key" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductPulseSchedulerLock_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ProductPulseSchedulerLock_expiresAt_idx" ON "ProductPulseSchedulerLock"("expiresAt");
