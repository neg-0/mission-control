-- CreateTable
CREATE TABLE "public"."ProjectConstraint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "techStack" JSONB,
    "infrastructure" JSONB,
    "protectedFiles" TEXT[],
    "forbiddenOps" TEXT[],
    "allowedDeployCommands" TEXT[],
    "monthlyBudgetUsd" DOUBLE PRECISION,
    "maxCostPerAction" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL,
    "boundaries" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentRole" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "projectId" TEXT,
    "assignedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CredentialGrant" (
    "id" TEXT NOT NULL,
    "credentialKey" TEXT NOT NULL,
    "grantedToAgent" TEXT NOT NULL,
    "grantedByAgent" TEXT NOT NULL,
    "projectId" TEXT,
    "accessLevel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecisionLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "alternatives" JSONB,
    "decidedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConstraint_projectId_key" ON "public"."ProjectConstraint"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "public"."Role"("name");

-- CreateIndex
CREATE INDEX "AgentRole_agentId_idx" ON "public"."AgentRole"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRole_agentId_roleId_projectId_key" ON "public"."AgentRole"("agentId", "roleId", "projectId");

-- CreateIndex
CREATE INDEX "CredentialGrant_grantedToAgent_idx" ON "public"."CredentialGrant"("grantedToAgent");

-- CreateIndex
CREATE INDEX "CredentialGrant_grantedByAgent_idx" ON "public"."CredentialGrant"("grantedByAgent");

-- CreateIndex
CREATE INDEX "DecisionLog_entityType_entityId_idx" ON "public"."DecisionLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DecisionLog_decidedBy_createdAt_idx" ON "public"."DecisionLog"("decidedBy", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."ProjectConstraint" ADD CONSTRAINT "ProjectConstraint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentRole" ADD CONSTRAINT "AgentRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
