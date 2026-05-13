CREATE TABLE "ProductPulseJobLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPulseJobLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductPulseJobLog_shop_createdAt_idx" ON "ProductPulseJobLog"("shop", "createdAt");
CREATE INDEX "ProductPulseJobLog_jobId_createdAt_idx" ON "ProductPulseJobLog"("jobId", "createdAt");
