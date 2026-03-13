-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "modelFallback" TEXT,
ADD COLUMN     "modelPrimary" TEXT,
ADD COLUMN     "providerFallback" TEXT,
ADD COLUMN     "providerPrimary" TEXT,
ADD COLUMN     "runtimeMode" TEXT NOT NULL DEFAULT 'gateway';

-- AlterTable
ALTER TABLE "public"."Idea" ADD COLUMN     "sourceUrls" TEXT[];

-- AlterTable
ALTER TABLE "public"."Project" ADD COLUMN     "railwayEnvironmentId" TEXT,
ADD COLUMN     "railwayProjectId" TEXT;

-- CreateTable
CREATE TABLE "public"."AgentSession" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tokensSent" INTEGER NOT NULL DEFAULT 0,
    "tokensRecv" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "triggerType" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "agentId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'learned',
    "content" TEXT NOT NULL,
    "embedding" BYTEA,
    "source" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CarPlayAlert" (
    "id" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "promotedFrom" INTEGER,
    "sourceId" TEXT,
    "sourceType" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CarPlayAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeviceToken" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CarPlayAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarPlayAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSession_agentId_startedAt_idx" ON "public"."AgentSession"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_status_idx" ON "public"."AgentSession"("status");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_projectId_category_idx" ON "public"."KnowledgeEntry"("projectId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_agentId_createdAt_idx" ON "public"."KnowledgeEntry"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CarPlayAlert_dedupeKey_key" ON "public"."CarPlayAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "CarPlayAlert_severity_triggeredAt_idx" ON "public"."CarPlayAlert"("severity", "triggeredAt");

-- CreateIndex
CREATE INDEX "CarPlayAlert_resolved_severity_idx" ON "public"."CarPlayAlert"("resolved", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_deviceId_key" ON "public"."DeviceToken"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceToken_deviceId_idx" ON "public"."DeviceToken"("deviceId");

-- CreateIndex
CREATE INDEX "CarPlayAuditLog_deviceId_createdAt_idx" ON "public"."CarPlayAuditLog"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."AgentSession" ADD CONSTRAINT "AgentSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
