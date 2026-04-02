-- AlterTable: add OpenClaw cron job fields to Schedule
ALTER TABLE "Schedule" ADD COLUMN "scheduleKind"      TEXT    NOT NULL DEFAULT 'cron';
ALTER TABLE "Schedule" ADD COLUMN "scheduleAt"        TEXT;
ALTER TABLE "Schedule" ADD COLUMN "tz"                TEXT;
ALTER TABLE "Schedule" ADD COLUMN "anchorMs"          BIGINT;
ALTER TABLE "Schedule" ADD COLUMN "sessionTarget"     TEXT;
ALTER TABLE "Schedule" ADD COLUMN "wakeMode"          TEXT;
ALTER TABLE "Schedule" ADD COLUMN "deleteAfterRun"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Schedule" ADD COLUMN "lastStatus"        TEXT;
ALTER TABLE "Schedule" ADD COLUMN "lastDurationMs"    INTEGER;
ALTER TABLE "Schedule" ADD COLUMN "consecutiveErrors" INTEGER NOT NULL DEFAULT 0;
