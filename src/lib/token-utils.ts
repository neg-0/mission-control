/**
 * @module token-utils
 * @description
 * Utilities for persisting Railway OAuth tokens to .env files,
 * distributing access tokens to OpenClaw agent workspaces,
 * and generating per-project Railway tokens via the GraphQL API.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const OPENCLAW_DIR = '/home/neg0/.openclaw';
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
const MC_ENV_PATH = path.join(process.cwd(), '.env');

const RAILWAY_GQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

// ---------------------------------------------------------------------------
// Fresh token retrieval (avoids stale process.env)
// ---------------------------------------------------------------------------

/**
 * Read the Railway account token directly from the .env file.
 * Falls back to process.env if file read fails.
 * 
 * This is important because process.env can hold a stale token
 * if the token was refreshed by a different process (e.g. cron curl, tsx script).
 */
export async function getFreshAccountToken(): Promise<string | null> {
  try {
    const content = await readFile(MC_ENV_PATH, 'utf-8');
    const match = content.match(/^RAILWAY_API_TOKEN=(.+)$/m);
    return match?.[1]?.trim() ?? process.env.RAILWAY_API_TOKEN ?? null;
  } catch {
    return process.env.RAILWAY_API_TOKEN ?? null;
  }
}

// ---------------------------------------------------------------------------
// .env file manipulation
// ---------------------------------------------------------------------------

/**
 * Update (or append) a single KEY=value in a .env file.
 * - If the key already exists, its value is replaced in-place.
 * - If the key does not exist, a new line is appended.
 * - Preserves all other content and comments.
 */
export async function updateEnvVar(
  envPath: string,
  key: string,
  value: string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist yet — we'll create it
    content = '';
  }

  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    // Ensure there's a trailing newline before appending
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `${key}=${value}\n`;
  }

  await writeFile(envPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Agent workspace discovery
// ---------------------------------------------------------------------------

interface OpenClawAgent {
  id: string;
  workspace: string;
}

/**
 * Read openclaw.json and return the list of agent workspace paths.
 */
export async function getAgentWorkspaces(): Promise<string[]> {
  const raw = await readFile(OPENCLAW_CONFIG, 'utf-8');
  const config = JSON.parse(raw);
  const agents: OpenClawAgent[] = config?.agents?.list ?? [];
  return agents.map((a) => a.workspace).filter(Boolean);
}

/**
 * Read openclaw.json and return agent id → workspace path mapping.
 */
export async function getAgentWorkspaceMap(): Promise<Map<string, string>> {
  const raw = await readFile(OPENCLAW_CONFIG, 'utf-8');
  const config = JSON.parse(raw);
  const agents: OpenClawAgent[] = config?.agents?.list ?? [];
  const map = new Map<string, string>();
  for (const a of agents) {
    if (a.id && a.workspace) {
      map.set(a.id, a.workspace);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Account token distribution
// ---------------------------------------------------------------------------

/**
 * Write RAILWAY_API_TOKEN=<token> into every agent workspace's .env file.
 * Logs successes and failures but does not throw on individual failures
 * so one broken workspace doesn't block the rest.
 */
export async function distributeTokenToAgents(
  token: string,
): Promise<{ updated: string[]; failed: string[] }> {
  const workspaces = await getAgentWorkspaces();
  const updated: string[] = [];
  const failed: string[] = [];

  for (const ws of workspaces) {
    const envPath = path.join(ws, '.env');
    try {
      await updateEnvVar(envPath, 'RAILWAY_API_TOKEN', token);
      updated.push(ws);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[TokenDistribute] Failed to update ${envPath}:`, err);
      failed.push(ws);
    }
  }

  return { updated, failed };
}

// ---------------------------------------------------------------------------
// Mission Control token persistence
// ---------------------------------------------------------------------------

/**
 * Persist tokens to Mission Control's own .env and update process.env in-memory.
 */
export async function persistMCTokens(
  accessToken: string,
  refreshToken?: string,
): Promise<void> {
  await updateEnvVar(MC_ENV_PATH, 'RAILWAY_API_TOKEN', accessToken);
  process.env.RAILWAY_API_TOKEN = accessToken;

  if (refreshToken) {
    await updateEnvVar(MC_ENV_PATH, 'RAILWAY_REFRESH_TOKEN', refreshToken);
    process.env.RAILWAY_REFRESH_TOKEN = refreshToken;
  }

  // Track when the token was last refreshed
  const now = new Date().toISOString();
  await updateEnvVar(MC_ENV_PATH, 'RAILWAY_LAST_REFRESH_AT', now);
  process.env.RAILWAY_LAST_REFRESH_AT = now;
}

// ---------------------------------------------------------------------------
// Railway GraphQL: Project token generation
// ---------------------------------------------------------------------------

/**
 * Generate a project-scoped token via Railway's GraphQL API.
 * Uses the account-level OAuth token to authenticate.
 *
 * @returns The project token string, or null if generation failed.
 */
export async function generateProjectToken(
  accountToken: string,
  projectId: string,
  environmentId: string,
  tokenName: string,
): Promise<string | null> {
  const mutation = `
    mutation ProjectTokenCreate($input: ProjectTokenCreateInput!) {
      projectTokenCreate(input: $input)
    }
  `;

  try {
    const response = await fetch(RAILWAY_GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accountToken}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            projectId,
            environmentId,
            name: tokenName,
          },
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      // eslint-disable-next-line no-console
      console.error(`[ProjectToken] HTTP ${response.status} for project ${projectId}:`, errBody);
      return null;
    }

    const result = await response.json();

    // eslint-disable-next-line no-console
    console.log(`[ProjectToken] Response for ${projectId}:`, JSON.stringify(result).slice(0, 200));

    if (result.errors) {
      // eslint-disable-next-line no-console
      console.error(`[ProjectToken] GraphQL errors for project ${projectId}:`, result.errors);
      return null;
    }

    return result.data?.projectTokenCreate ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ProjectToken] Failed for project ${projectId}:`, err);
    return null;
  }
}

/**
 * For each MC Project with a railwayProjectId, generate a project token
 * and distribute it to the owner agent's workspace as RAILWAY_TOKEN.
 *
 * @returns Summary of what was distributed
 */
export async function distributeProjectTokens(
  accountToken: string,
): Promise<{ generated: string[]; failed: string[]; skipped: string[] }> {
  // Lazy-import Prisma to avoid circular deps / build issues
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const generated: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  try {
    const projects = await prisma.project.findMany({
      where: {
        railwayProjectId: { not: null },
        railwayEnvironmentId: { not: null },
        ownerAgentId: { not: null },
      },
      select: {
        id: true,
        name: true,
        railwayProjectId: true,
        railwayEnvironmentId: true,
        ownerAgentId: true,
      },
    });

    if (projects.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[ProjectToken] No projects with Railway IDs configured — skipping');
      return { generated, failed, skipped };
    }

    const agentWorkspaces = await getAgentWorkspaceMap();

    for (const project of projects) {
      const agentId = project.ownerAgentId!;
      const workspace = agentWorkspaces.get(agentId);

      if (!workspace) {
        // eslint-disable-next-line no-console
        console.warn(`[ProjectToken] Agent ${agentId} has no workspace — skipping ${project.name}`);
        skipped.push(project.name);
        continue;
      }

      const token = await generateProjectToken(
        accountToken,
        project.railwayProjectId!,
        project.railwayEnvironmentId!,
        `mc-${agentId}-${project.id}`,
      );

      if (token) {
        const envPath = path.join(workspace, '.env');
        try {
          await updateEnvVar(envPath, 'RAILWAY_TOKEN', token);
          generated.push(`${project.name} → ${agentId}`);
          // eslint-disable-next-line no-console
          console.log(`[ProjectToken] Generated and distributed to ${agentId} for ${project.name}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[ProjectToken] Failed to write token for ${agentId}:`, err);
          failed.push(`${project.name} → ${agentId}`);
        }
      } else {
        failed.push(`${project.name} → ${agentId}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return { generated, failed, skipped };
}

// ---------------------------------------------------------------------------
// Auto-discovery: match Railway projects to MC projects
// ---------------------------------------------------------------------------

interface RailwayProject {
  id: string;
  name: string;
  environments: { edges: Array<{ node: { id: string; name: string } }> };
}

/**
 * Query Railway for all projects, then match them to MC projects by name.
 * Links railwayProjectId + railwayEnvironmentId on matched projects.
 *
 * Matching is case-insensitive and ignores hyphens/spaces.
 */
export async function discoverAndLinkRailwayProjects(
  accountToken: string,
): Promise<{ linked: string[]; unmatched: string[] }> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const linked: string[] = [];
  const unmatched: string[] = [];

  try {
    // 1. Fetch all Railway workspaces, then projects per workspace
    //    Railway V2 API scopes projects under workspaces, not me.projects
    const wsQuery = `{ me { workspaces { id name } } }`;

    const wsResp = await fetch(RAILWAY_GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accountToken}`,
      },
      body: JSON.stringify({ query: wsQuery }),
    });

    if (!wsResp.ok) {
      // eslint-disable-next-line no-console
      console.error('[Discovery] Railway API returned', wsResp.status);
      return { linked, unmatched };
    }

    const wsData = await wsResp.json();
    if (wsData.errors) {
      // eslint-disable-next-line no-console
      console.error('[Discovery] Workspace query errors:', wsData.errors);
      return { linked, unmatched };
    }

    const workspaces: Array<{ id: string; name: string }> =
      wsData.data?.me?.workspaces ?? [];

    // eslint-disable-next-line no-console
    console.log(`[Discovery] Found ${workspaces.length} Railway workspace(s)`);

    // 2. For each workspace, fetch its projects
    const allRailwayProjects: RailwayProject[] = [];

    for (const ws of workspaces) {
      const projQuery = `{
        workspace(workspaceId: "${ws.id}") {
          projects {
            edges {
              node {
                id
                name
                environments {
                  edges {
                    node { id name }
                  }
                }
              }
            }
          }
        }
      }`;

      const projResp = await fetch(RAILWAY_GQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accountToken}`,
        },
        body: JSON.stringify({ query: projQuery }),
      });

      if (!projResp.ok) continue;

      const projData = await projResp.json();
      if (projData.errors) {
        // eslint-disable-next-line no-console
        console.error(`[Discovery] Project query errors for workspace ${ws.name}:`, projData.errors);
        continue;
      }

      const edges = projData.data?.workspace?.projects?.edges ?? [];
      for (const e of edges) {
        allRailwayProjects.push(e.node);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Discovery] Found ${allRailwayProjects.length} Railway project(s)`);

    const railwayProjects = allRailwayProjects;

    // 2. Fetch MC projects
    const mcProjects = await prisma.project.findMany({
      select: { id: true, name: true, railwayProjectId: true },
    });

    // 3. Normalize for matching: lowercase, strip hyphens and spaces
    const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');

    for (const rp of railwayProjects) {
      const rpNorm = normalize(rp.name);

      const match = mcProjects.find(
        (mc) => normalize(mc.name) === rpNorm || normalize(mc.id) === rpNorm,
      );

      if (match) {
        // Pick "production" env, or first available
        const envs = rp.environments.edges.map((e) => e.node);
        const prodEnv = envs.find((e) => e.name.toLowerCase() === 'production') ?? envs[0];

        if (prodEnv) {
          await prisma.project.update({
            where: { id: match.id },
            data: {
              railwayProjectId: rp.id,
              railwayEnvironmentId: prodEnv.id,
            },
          });
          linked.push(`${rp.name} → ${match.id} (env: ${prodEnv.name})`);
          // eslint-disable-next-line no-console
          console.log(`[Discovery] Linked: ${rp.name} → MC:${match.id} (env ${prodEnv.name})`);
        }
      } else {
        unmatched.push(rp.name);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return { linked, unmatched };
}

// ---------------------------------------------------------------------------
// Self-service: get project token for a specific agent
// ---------------------------------------------------------------------------

/**
 * Look up an agent's project, generate a Railway project token,
 * and optionally write it to the agent's workspace .env.
 *
 * @returns The generated token and project info, or an error.
 */
export async function getProjectTokenForAgent(
  accountToken: string,
  agentId: string,
  writeToEnv: boolean = true,
): Promise<{
  ok: boolean;
  token?: string;
  projectId?: string;
  projectName?: string;
  error?: string;
}> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Find the agent's project with Railway linkage
    const project = await prisma.project.findFirst({
      where: {
        ownerAgentId: agentId,
        railwayProjectId: { not: null },
        railwayEnvironmentId: { not: null },
      },
      select: {
        id: true,
        name: true,
        railwayProjectId: true,
        railwayEnvironmentId: true,
      },
    });

    if (!project) {
      return {
        ok: false,
        error: `No Railway-linked project found for agent "${agentId}". ` +
          `Ensure the project has railwayProjectId and railwayEnvironmentId set.`,
      };
    }

    const token = await generateProjectToken(
      accountToken,
      project.railwayProjectId!,
      project.railwayEnvironmentId!,
      `mc-${agentId}-${project.id}`,
    );

    if (!token) {
      return {
        ok: false,
        projectId: project.id,
        projectName: project.name,
        error: `Failed to generate token via Railway API for project "${project.name}".`,
      };
    }

    // Write to agent's workspace .env if requested
    if (writeToEnv) {
      const workspaces = await getAgentWorkspaceMap();
      const ws = workspaces.get(agentId);
      if (ws) {
        await updateEnvVar(path.join(ws, '.env'), 'RAILWAY_TOKEN', token);
      }
    }

    return {
      ok: true,
      token,
      projectId: project.id,
      projectName: project.name,
    };
  } finally {
    await prisma.$disconnect();
  }
}
