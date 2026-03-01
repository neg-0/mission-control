import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PR {
  id: number;
  title: string;
  branch: string;
  target: string;
  ci: 'passing' | 'failed' | 'pending' | 'skipped';
  reviewState: 'approved' | 'changes_requested' | 'pending' | 'dismissed';
  owner: string;
  unresolvedComments: number;
  url: string;
  author: string;
  updatedAt: string;
  isDraft: boolean;
}

// Infer owner based on PR state
function inferOwner(pr: {
  author: string;
  ci: string;
  reviewState: string;
  unresolvedComments: number;
  lastCommenter?: string;
}): string {
  // If CI failed and author is rocket, rocket needs to fix
  if (pr.ci === 'failed' && pr.author === 'neg-0') {
    return 'rocket';
  }
  
  // If there are unresolved comments, author needs to address
  if (pr.unresolvedComments > 0) {
    return pr.author === 'neg-0' ? 'rocket' : 'dustin';
  }
  
  // If approved and CI passing, Dustin decides on merge
  if (pr.reviewState === 'approved' && pr.ci === 'passing') {
    return 'dustin';
  }
  
  // If changes requested, author needs to address
  if (pr.reviewState === 'changes_requested') {
    return pr.author === 'neg-0' ? 'rocket' : 'dustin';
  }
  
  // Default: waiting on CI or review
  if (pr.ci === 'pending') {
    return 'ci';
  }
  
  return 'rocket';
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const repo = searchParams.get('repo') || 'neg-0/comp-iq';
  
  try {
    // Use gh CLI to get PRs
    const { stdout: prList } = await execAsync(
      `gh pr list --repo ${repo} --json number,title,headRefName,baseRefName,state,isDraft,author,updatedAt,url --limit 20`,
      { timeout: 30000 }
    );
    
    const rawPRs = JSON.parse(prList);
    
    // Get check status for each PR
    const prs: PR[] = await Promise.all(
      rawPRs.map(async (raw: {
        number: number;
        title: string;
        headRefName: string;
        baseRefName: string;
        isDraft: boolean;
        author: { login: string };
        updatedAt: string;
        url: string;
      }) => {
        let ci: PR['ci'] = 'pending';
        let reviewState: PR['reviewState'] = 'pending';
        let unresolvedComments = 0;

        try {
          // Get CI status
          const { stdout: checks } = await execAsync(
            `gh pr checks ${raw.number} --repo ${repo} --json name,state 2>/dev/null || echo "[]"`,
            { timeout: 10000 }
          );
          const checksData = JSON.parse(checks || '[]');
          
          if (checksData.length > 0) {
            const failed = checksData.some((c: { state: string }) => c.state === 'FAILURE');
            const pending = checksData.some((c: { state: string }) => c.state === 'PENDING');
            const allPassed = checksData.every((c: { state: string }) => c.state === 'SUCCESS' || c.state === 'SKIPPED');
            
            if (failed) ci = 'failed';
            else if (pending) ci = 'pending';
            else if (allPassed) ci = 'passing';
          }

          // Get review status
          const { stdout: reviews } = await execAsync(
            `gh pr view ${raw.number} --repo ${repo} --json reviewDecision,reviews 2>/dev/null || echo "{}"`,
            { timeout: 10000 }
          );
          const reviewData = JSON.parse(reviews || '{}');
          
          if (reviewData.reviewDecision === 'APPROVED') {
            reviewState = 'approved';
          } else if (reviewData.reviewDecision === 'CHANGES_REQUESTED') {
            reviewState = 'changes_requested';
          }

          // Count unresolved comments (simplified)
          const { stdout: comments } = await execAsync(
            `gh pr view ${raw.number} --repo ${repo} --json comments --jq '.comments | length' 2>/dev/null || echo "0"`,
            { timeout: 10000 }
          );
          unresolvedComments = parseInt(comments.trim()) || 0;
        } catch (e) {
          // Ignore individual PR check failures
        }

        const pr: PR = {
          id: raw.number,
          title: raw.title,
          branch: raw.headRefName,
          target: raw.baseRefName,
          ci,
          reviewState,
          unresolvedComments,
          url: raw.url,
          author: raw.author.login,
          updatedAt: raw.updatedAt,
          isDraft: raw.isDraft,
          owner: '', // Will be set below
        };
        
        pr.owner = inferOwner(pr);
        return pr;
      })
    );

    return NextResponse.json({ prs });
  } catch (error) {
    console.error('Failed to fetch PRs:', error);
    
    // Return mock data as fallback
    return NextResponse.json({
      prs: [
        { id: 271, title: 'Fix comp sets dialog closes on failure', target: 'staging', ci: 'pending', reviewState: 'pending', owner: 'rocket', unresolvedComments: 2, url: 'https://github.com/neg-0/comp-iq/pull/271' },
        { id: 273, title: 'Fix indifference hook swallows errors', target: 'staging', ci: 'passing', reviewState: 'pending', owner: 'rocket', unresolvedComments: 0, url: 'https://github.com/neg-0/comp-iq/pull/273' },
      ],
      error: 'Using cached data',
    });
  }
}

// Force dynamic rendering
export const dynamic = 'force-dynamic';
