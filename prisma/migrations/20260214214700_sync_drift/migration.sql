-- Baseline migration: captures schema changes that were applied via `db push`
-- but never recorded as migrations (CostEntry table, Schedule columns, 
-- OrchestratorConfig columns, Idea refinery fields).

-- CostEntry table (current shape: notes, source, recurring, createdAt, updatedAt)
CREATE TABLE IF NOT EXISTS "CostEntry" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'infra',
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CostEntry_category_idx" ON "CostEntry"("category");
CREATE INDEX IF NOT EXISTS "CostEntry_date_idx" ON "CostEntry"("date");
CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_service_date_key" ON "CostEntry"("service", "date");

-- Schedule: new columns (channel is required with default)
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'discord';
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "deliverTo" TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'cron';
CREATE INDEX IF NOT EXISTS "Schedule_type_idx" ON "Schedule"("type");

-- OrchestratorConfig: new columns
ALTER TABLE "OrchestratorConfig" ADD COLUMN IF NOT EXISTS "staggerDelayMs" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "OrchestratorConfig" ADD COLUMN IF NOT EXISTS "tickIntervalMs" INTEGER NOT NULL DEFAULT 60000;

-- Idea: refinery fields
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'pain_audit';
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "validationStartedAt" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "validationDeadline" TIMESTAMP(3);
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "validationTarget" INTEGER DEFAULT 10;
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "refineryData" JSONB;
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "validationMetrics" JSONB;
ALTER TABLE "Idea" ALTER COLUMN "status" SET DEFAULT 'draft';
