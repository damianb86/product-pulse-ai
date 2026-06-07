CREATE TABLE "ProductPulseOpenAiBatchGroup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitting',
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "completedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "failedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "resumePayload" JSONB,
    "result" JSONB,
    "metadata" JSONB,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseOpenAiBatchGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPulseOpenAiBatch" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "openAiBatchId" TEXT,
    "inputFileId" TEXT,
    "outputFileId" TEXT,
    "errorFileId" TEXT,
    "endpoint" TEXT NOT NULL DEFAULT '/v1/responses',
    "completionWindow" TEXT NOT NULL DEFAULT '24h',
    "model" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "completedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "failedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseOpenAiBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPulseOpenAiBatchRequest" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "customId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "request" JSONB NOT NULL,
    "response" JSONB,
    "error" JSONB,
    "outputText" TEXT,
    "usage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseOpenAiBatchRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPulseOpenAiWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "openAiObjectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseOpenAiWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductPulseOpenAiBatchGroup_jobId_key" ON "ProductPulseOpenAiBatchGroup"("jobId");
CREATE INDEX "ProductPulseOpenAiBatchGroup_shop_status_updatedAt_idx" ON "ProductPulseOpenAiBatchGroup"("shop", "status", "updatedAt");
CREATE INDEX "ProductPulseOpenAiBatchGroup_shop_jobId_idx" ON "ProductPulseOpenAiBatchGroup"("shop", "jobId");
CREATE INDEX "ProductPulseOpenAiBatchGroup_jobId_status_idx" ON "ProductPulseOpenAiBatchGroup"("jobId", "status");

CREATE UNIQUE INDEX "ProductPulseOpenAiBatch_openAiBatchId_key" ON "ProductPulseOpenAiBatch"("openAiBatchId");
CREATE INDEX "ProductPulseOpenAiBatch_shop_status_updatedAt_idx" ON "ProductPulseOpenAiBatch"("shop", "status", "updatedAt");
CREATE INDEX "ProductPulseOpenAiBatch_shop_jobId_idx" ON "ProductPulseOpenAiBatch"("shop", "jobId");
CREATE INDEX "ProductPulseOpenAiBatch_groupId_status_idx" ON "ProductPulseOpenAiBatch"("groupId", "status");
CREATE INDEX "ProductPulseOpenAiBatch_jobId_status_idx" ON "ProductPulseOpenAiBatch"("jobId", "status");

CREATE UNIQUE INDEX "ProductPulseOpenAiBatchRequest_customId_key" ON "ProductPulseOpenAiBatchRequest"("customId");
CREATE INDEX "ProductPulseOpenAiBatchRequest_batchId_idx" ON "ProductPulseOpenAiBatchRequest"("batchId");
CREATE INDEX "ProductPulseOpenAiBatchRequest_task_status_idx" ON "ProductPulseOpenAiBatchRequest"("task", "status");

CREATE INDEX "ProductPulseOpenAiWebhookEvent_type_receivedAt_idx" ON "ProductPulseOpenAiWebhookEvent"("type", "receivedAt");
CREATE INDEX "ProductPulseOpenAiWebhookEvent_openAiObjectId_idx" ON "ProductPulseOpenAiWebhookEvent"("openAiObjectId");

ALTER TABLE "ProductPulseOpenAiBatch"
  ADD CONSTRAINT "ProductPulseOpenAiBatch_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ProductPulseOpenAiBatchGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductPulseOpenAiBatchRequest"
  ADD CONSTRAINT "ProductPulseOpenAiBatchRequest_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ProductPulseOpenAiBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
