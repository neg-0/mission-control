-- CreateTable
CREATE TABLE "public"."RecoveryLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryLog_agentId_createdAt_idx" ON "public"."RecoveryLog"("agentId", "createdAt");
