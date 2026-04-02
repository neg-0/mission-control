/**
 * Boot Context Validation — M3.3 — Agent Startup Verification
 *
 * Validates that an agent has all required files and configurations before boot.
 * Ensures SOUL.md contains critical sections and manifest is valid.
 */

import { promises as fs } from 'fs';
import { prisma } from './prisma';
import { validateManifest } from './project-manifest';

/**
 * Boot Context Configuration Interface
 */
export interface BootContextConfig {
  agentId: string;
  workspacePath: string;
  requiredFiles: string[]; // Files that MUST exist before boot
  soulTemplate: string; // Path to SOUL.md template
  heartbeatPath?: string; // Path to HEARTBEAT.md
  manifestPath?: string; // Path to project.lock.json
}

/**
 * Default required files for boot
 */
export const DEFAULT_REQUIRED_FILES = [
  'SOUL.md',
  'HEARTBEAT.md',
  'GOALS.md',
  'project.lock.json',
];

/**
 * Boot Context Validation Result
 */
export interface BootContextValidationResult {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Load SOUL.md content for an agent.
 * Prefers Agent.soulContent from DB; falls back to filesystem with a deprecation warning.
 */
export async function loadSoulContent(
  agentId: string,
  workspacePath: string
): Promise<{ content: string | null; warnings: string[] }> {
  const warnings: string[] = [];

  // Prefer DB
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { soulContent: true },
  });

  if (agent?.soulContent) {
    return { content: agent.soulContent, warnings };
  }

  // Fallback to filesystem
  const soulPath = workspacePath.endsWith('/')
    ? `${workspacePath}SOUL.md`
    : `${workspacePath}/SOUL.md`;

  try {
    const content = await fs.readFile(soulPath, 'utf-8');
    warnings.push(
      `[DEPRECATION] Agent "${agentId}" soulContent loaded from filesystem (${soulPath}). ` +
        `Migrate SOUL.md content to Agent.soulContent in the database.`
    );
    return { content, warnings };
  } catch {
    return { content: null, warnings };
  }
}

/**
 * Validate boot context
 *
 * - Checks each required file exists
 * - Validates SOUL.md contains critical sections (from DB or filesystem)
 * - If manifestPath is provided, reads and validates the manifest
 * - Returns validation result with errors and warnings
 */
export async function validateBootContext(
  config: BootContextConfig
): Promise<BootContextValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Resolve file paths
  const requiredFilePaths = config.requiredFiles.map((file) =>
    config.workspacePath.endsWith('/')
      ? `${config.workspacePath}${file}`
      : `${config.workspacePath}/${file}`
  );

  // Check each required file exists
  for (const filePath of requiredFilePaths) {
    try {
      await fs.access(filePath);
    } catch {
      errors.push(`Required file not found: ${filePath}`);
    }
  }

  // Validate SOUL.md content (prefer DB, fall back to filesystem)
  const { content: soulContent, warnings: soulWarnings } = await loadSoulContent(
    config.agentId,
    config.workspacePath
  );
  warnings.push(...soulWarnings);

  if (soulContent) {
    const criticalSections = [
      'Budget Limits',
      'Deploy Restrictions',
      'Scope Boundaries',
    ];

    for (const section of criticalSections) {
      if (!soulContent.includes(section)) {
        errors.push(`SOUL.md missing critical section: "${section}"`);
      }
    }
  } else {
    errors.push(
      `Failed to read SOUL.md for agent "${config.agentId}" (not in DB and not on filesystem)`
    );
  }

  // Validate manifest if path provided
  if (config.manifestPath) {
    try {
      const manifestPath = config.workspacePath.endsWith('/')
        ? `${config.workspacePath}${config.manifestPath}`
        : `${config.workspacePath}/${config.manifestPath}`;

      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      const validationResult = validateManifest(manifest);
      if (!validationResult.valid) {
        errors.push(`Manifest validation failed: ${validationResult.errors.join('; ')}`);
      }
    } catch (e) {
      errors.push(
        `Failed to validate manifest: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    ready: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generate SOUL.md template from Agent and Project data
 *
 * Returns a SOUL.md template string with:
 * - Identity (agent ID, project scope)
 * - Mission and objectives
 * - Budget limits
 * - Deploy restrictions
 * - Scope boundaries
 * - Communication protocol
 *
 * @param agentId - Agent ID to query
 * @param projectId - Project ID to query
 * @returns SOUL.md template string
 * @throws If Agent or Project not found
 */
export async function generateSoulFromTemplate(
  agentId: string,
  projectId: string
): Promise<string> {
  // Query Agent
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
  });

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Query Project
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Generate SOUL.md template
  const soul = `# SOUL.md — Agent Identity & Boundaries

Agent: **${agent.id}**
Project: **${project.name}** (${projectId})
Role: ${agent.role}
Status: ${agent.status}
Generated: ${new Date().toISOString()}

---

## Identity

- **Agent ID**: ${agent.id}
- **Role**: ${agent.role}
- **Workspace**: ${agent.workspacePath}
- **Runtime Mode**: ${agent.runtimeMode || 'gateway'}
- **Primary Model**: ${agent.modelPrimary || 'gpt-4'} (${agent.providerPrimary || 'openai'})

## Mission

This agent is tasked with building and maintaining: **${project.name}**

**Project Stage**: ${project.stage || 'unknown'}
**Repository**: ${project.repoUrl || 'Not set'}
**Description**: ${project.description || 'No description provided'}

## Budget Limits

- **Monthly Budget**: $500 USD
- **Max Cost Per Action**: $10 USD
- **Monitoring**: Cost tracking is enabled and monitored via CarPlay

### Cost Tracking Categories
- Infrastructure (Hetzner, Railway, etc.)
- AI Model Usage (OpenAI, Anthropic, Gemini, etc.)
- External Services (GitHub, Stripe, etc.)
- Other SaaS Tools

## Deploy Restrictions

- **Allow Deploy**: true
- **Deploy Targets**: ${project.railwayProjectId ? 'Railway, Vercel' : 'None configured'}
- **Require Approval For**:
  - Production deployments
  - Database schema changes
  - Resource deletion
  - Security-related changes

### Railway Integration
${project.railwayProjectId ? `- **Railway Project ID**: ${project.railwayProjectId}` : '- No Railway integration configured'}
${project.railwayEnvironmentId ? `- **Environment**: ${project.railwayEnvironmentId}` : ''}

## Scope Boundaries

### Allowed Paths
- \`${agent.workspacePath}\` — Main workspace
- \`${agent.workspacePath}/src\` — Source code
- \`${agent.workspacePath}/docs\` — Documentation
- \`${agent.workspacePath}/scripts\` — Automation scripts

### Protected Files (DO NOT MODIFY)
- \`SOUL.md\` — This file (agent identity)
- \`project.lock.json\` — Manifest (immutable)
- \`.env\` and \`.env.local\` — Credentials
- Critical configuration files

### Database Access
${project.dbActive ? `- **Enabled**: Yes (${project.dbProvider || 'unknown'} provider)` : '- **Enabled**: No'}

### External API Access
Approved domains:
- api.github.com
- api.stripe.com
- railway.app
- vercel.com

### Repository Access
${project.repoUrl ? `- **Allowed**: ${project.repoUrl}` : '- **Allowed**: None configured'}

## Communication Protocol

### Heartbeat
- Interval: Every 60 minutes (configurable via Schedule)
- Channel: Discord
- Content: Status update, blockers, accomplishments

### Escalations
Escalate to **Dustin** (human operator) for:
- Budget overruns
- Security concerns
- Critical bugs in production
- Merge conflicts
- Deployment failures

### Messages
- Use \`MessageLog\` for audit trail
- Acknowledge receipt with status
- Timestamp all communications

---

**Last Updated**: ${new Date().toISOString()}
`;

  return soul;
}
