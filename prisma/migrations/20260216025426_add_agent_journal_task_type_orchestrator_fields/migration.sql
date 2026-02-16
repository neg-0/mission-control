-- AlterTable
ALTER TABLE "OrchestratorConfig" ADD COLUMN     "journalEntries" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "mdInjections" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "taskType" TEXT NOT NULL DEFAULT 'one_off';

-- CreateTable
CREATE TABLE "AgentJournal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "next" TEXT,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "blockers" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentJournal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentJournal_agentId_createdAt_idx" ON "AgentJournal"("agentId", "createdAt");
