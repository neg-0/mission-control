/**
 * Project Manifest — M3.2 — Project Configuration Lockfile
 *
 * Immutable configuration for a CEO Pod defining boundaries, budget, and capabilities.
 * Generated from Agent + Project data, validated via SHA-256 hash.
 */

import { createHash } from 'crypto';
import { prisma } from './prisma';

/**
 * ProjectManifest Interface
 *
 * Immutable configuration for a CEO Pod that defines:
 * - Identity and versioning
 * - File system boundaries
 * - Budget constraints
 * - Deploy restrictions
 * - Scope and access
 * - Runtime configuration
 */
export interface ProjectManifest {
  version: '1.0';
  generatedAt: string; // ISO timestamp
  hash: string; // SHA-256 of the manifest content (excluding hash field)

  // Identity
  agentId: string;
  projectId: string;
  projectName: string;

  // Boundaries
  allowedPaths: string[]; // Directories the agent can write to
  protectedFiles: string[]; // Files the agent CANNOT modify (SOUL.md, project.lock.json, etc.)

  // Budget
  monthlyBudgetUsd: number;
  maxCostPerActionUsd: number;

  // Deploy restrictions
  allowDeploy: boolean;
  deployTargets: string[]; // e.g. ["railway", "vercel"]
  requireApproval: string[]; // Actions that need human approval

  // Scope
  repos: string[]; // Allowed GitHub repos
  dbAccess: boolean;
  externalApiAccess: string[]; // Allowed external API domains

  // Runtime
  runtimeMode: 'gateway' | 'native';
  model: string;
  provider: string;
}

/**
 * Compute SHA-256 hash of manifest content (excluding hash field)
 */
function computeManifestHash(manifest: Omit<ProjectManifest, 'hash'>): string {
  const content = JSON.stringify(manifest, null, 2);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate a manifest from Agent and Project data
 *
 * @param agentId - Agent ID to query
 * @param projectId - Project ID to query
 * @returns ProjectManifest object with computed hash
 * @throws If Agent or Project not found
 */
export async function generateManifest(
  agentId: string,
  projectId: string
): Promise<ProjectManifest> {
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
    include: { ownerAgent: true },
  });

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Build manifest with sensible defaults
  const manifestWithoutHash: Omit<ProjectManifest, 'hash'> = {
    version: '1.0',
    generatedAt: new Date().toISOString(),

    // Identity
    agentId: agent.id,
    projectId: project.id,
    projectName: project.name,

    // Boundaries
    allowedPaths: [
      agent.workspacePath,
      `${agent.workspacePath}/src`,
      `${agent.workspacePath}/docs`,
      `${agent.workspacePath}/scripts`,
    ],
    protectedFiles: [
      `${agent.workspacePath}/SOUL.md`,
      `${agent.workspacePath}/project.lock.json`,
      `${agent.workspacePath}/.env`,
      `${agent.workspacePath}/.env.local`,
    ],

    // Budget
    monthlyBudgetUsd: 500, // Default monthly budget
    maxCostPerActionUsd: 10, // Default per-action limit

    // Deploy restrictions
    allowDeploy: true,
    deployTargets: project.railwayProjectId ? ['railway'] : [],
    requireApproval: [
      'deploy_to_production',
      'modify_database_schema',
      'delete_resources',
    ],

    // Scope
    repos: project.repoUrl ? [project.repoUrl] : [],
    dbAccess: project.dbActive || false,
    externalApiAccess: [
      'api.github.com',
      'api.stripe.com',
      'railway.app',
      'vercel.com',
    ],

    // Runtime
    runtimeMode: agent.runtimeMode === 'native' ? 'native' : 'gateway',
    model: agent.modelPrimary || 'gpt-4',
    provider: agent.providerPrimary || 'openai',
  };

  // Compute hash
  const hash = computeManifestHash(manifestWithoutHash);

  return {
    ...manifestWithoutHash,
    hash,
  };
}

/**
 * Validation Result Interface
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a manifest
 *
 * - Recomputes the hash and compares
 * - Checks required fields are present
 * - Returns validation result with errors
 */
export function validateManifest(manifest: ProjectManifest): ManifestValidationResult {
  const errors: string[] = [];

  // Check required fields
  if (!manifest.version) errors.push('Missing required field: version');
  if (!manifest.generatedAt) errors.push('Missing required field: generatedAt');
  if (!manifest.agentId) errors.push('Missing required field: agentId');
  if (!manifest.projectId) errors.push('Missing required field: projectId');
  if (!manifest.projectName) errors.push('Missing required field: projectName');
  if (!Array.isArray(manifest.allowedPaths))
    errors.push('Missing or invalid field: allowedPaths');
  if (!Array.isArray(manifest.protectedFiles))
    errors.push('Missing or invalid field: protectedFiles');
  if (typeof manifest.monthlyBudgetUsd !== 'number')
    errors.push('Missing or invalid field: monthlyBudgetUsd');
  if (typeof manifest.maxCostPerActionUsd !== 'number')
    errors.push('Missing or invalid field: maxCostPerActionUsd');
  if (typeof manifest.allowDeploy !== 'boolean')
    errors.push('Missing or invalid field: allowDeploy');
  if (!Array.isArray(manifest.deployTargets))
    errors.push('Missing or invalid field: deployTargets');
  if (!Array.isArray(manifest.repos)) errors.push('Missing or invalid field: repos');
  if (typeof manifest.dbAccess !== 'boolean')
    errors.push('Missing or invalid field: dbAccess');
  if (!Array.isArray(manifest.externalApiAccess))
    errors.push('Missing or invalid field: externalApiAccess');
  if (!manifest.runtimeMode) errors.push('Missing required field: runtimeMode');
  if (!manifest.model) errors.push('Missing required field: model');
  if (!manifest.provider) errors.push('Missing required field: provider');

  // Validate version
  if (manifest.version !== '1.0') {
    errors.push(`Invalid version: ${manifest.version} (expected "1.0")`);
  }

  // Validate runtimeMode
  if (!['gateway', 'native'].includes(manifest.runtimeMode)) {
    errors.push(`Invalid runtimeMode: ${manifest.runtimeMode}`);
  }

  // Recompute hash and verify
  const manifestWithoutHash: Omit<ProjectManifest, 'hash'> = { ...manifest };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (manifestWithoutHash as any).hash;
  const expectedHash = computeManifestHash(manifestWithoutHash);

  if (manifest.hash !== expectedHash) {
    errors.push(
      `Hash mismatch: expected ${expectedHash}, got ${manifest.hash}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Diff Result Interface
 */
export interface ManifestDiff {
  field: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  current: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected: any;
}

/**
 * Compare two manifests field by field
 *
 * - Returns an array of diffs
 * - Ignores `generatedAt` and `hash` fields
 *
 * @param current - Current manifest
 * @param expected - Expected manifest
 * @returns Array of diffs
 */
export function diffManifests(
  current: ProjectManifest,
  expected: ProjectManifest
): ManifestDiff[] {
  const diffs: ManifestDiff[] = [];

  // Fields to compare (exclude generatedAt and hash)
  const fieldsToCompare = Object.keys(expected).filter(
    (key) => key !== 'generatedAt' && key !== 'hash'
  );

  for (const field of fieldsToCompare) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentValue = (current as any)[field];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedValue = (expected as any)[field];

    // Deep comparison for arrays
    if (Array.isArray(expectedValue)) {
      const currentArray = Array.isArray(currentValue) ? currentValue : [];
      const isEqual =
        currentArray.length === expectedValue.length &&
        currentArray.every((val, idx) => val === expectedValue[idx]);

      if (!isEqual) {
        diffs.push({
          field,
          current: currentArray,
          expected: expectedValue,
        });
      }
    } else if (typeof expectedValue === 'object' && expectedValue !== null) {
      // Deep comparison for objects
      const isEqual = JSON.stringify(currentValue) === JSON.stringify(expectedValue);
      if (!isEqual) {
        diffs.push({
          field,
          current: currentValue,
          expected: expectedValue,
        });
      }
    } else {
      // Simple value comparison
      if (currentValue !== expectedValue) {
        diffs.push({
          field,
          current: currentValue,
          expected: expectedValue,
        });
      }
    }
  }

  return diffs;
}
