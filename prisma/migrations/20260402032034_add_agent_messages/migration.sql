-- CreateTable
CREATE TABLE "public"."agent_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_messages_session_id_created_at_idx" ON "public"."agent_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."agent_messages" ADD CONSTRAINT "agent_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
