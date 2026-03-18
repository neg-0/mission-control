/**
 * Manifest API Route — GET /api/manifest
 *
 * Generate and return a project manifest for an agent.
 *
 * Query Parameters:
 *   - agentId: Agent ID (required)
 *   - projectId: Project ID (required)
 *
 * Response:
 *   - On success: { manifest: ProjectManifest }
 *   - On error: { error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateManifest } from '@/lib/project-manifest';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const projectId = searchParams.get('projectId');

    // Validate required parameters
    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: agentId' },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: projectId' },
        { status: 400 }
      );
    }

    // Generate the manifest
    const manifest = await generateManifest(agentId, projectId);

    return NextResponse.json({ manifest }, { status: 200 });
  } catch (error) {
    console.error('Manifest GET error:', error);

    // Handle specific error messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('not found')) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate manifest' },
      { status: 500 }
    );
  }
}
