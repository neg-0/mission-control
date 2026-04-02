-- Migration: add_agent_soul_and_system_prompt
-- Issues #30 and #31: Move agent SOUL files and system prompts from disk to Agent table

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "soulContent" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "systemPrompt" TEXT;
