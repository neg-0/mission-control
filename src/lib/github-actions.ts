/**
 * @module github-actions
 * @description
 * GitHub Actions REST API helpers for the stalled CI recovery playbook.
 *
 * These functions cancel in-progress workflow runs and re-trigger the
 * default branch workflow. Used by `recoverStalledCI()` in drift-recovery.ts.
 */

const GITHUB_API = 'https://api.github.com';

/**
 * Cancel all in-progress workflow runs for a repository.
 *
 * Queries `GET /repos/{owner}/{repo}/actions/runs?status=in_progress`
 * and POSTs cancel to each.
 */
export async function cancelWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
): Promise<number> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/runs?status=in_progress&per_page=10`,
    { headers },
  );

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const runs: Array<{ id: number }> = data.workflow_runs ?? [];

  let cancelled = 0;
  for (const run of runs) {
    const cancelRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${run.id}/cancel`,
      { method: 'POST', headers },
    );
    if (cancelRes.ok || cancelRes.status === 202) {
      cancelled++;
    }
  }

  return cancelled;
}

/**
 * Re-trigger the most recent workflow on the default branch.
 *
 * Uses `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun` on the
 * latest completed (or failed) workflow run.
 */
export async function retriggerWorkflow(
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Get the most recent workflow run
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=1`,
    { headers },
  );

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const runs: Array<{ id: number }> = data.workflow_runs ?? [];

  if (runs.length === 0) return false;

  const rerunRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runs[0].id}/rerun`,
    { method: 'POST', headers },
  );

  return rerunRes.ok || rerunRes.status === 201;
}
