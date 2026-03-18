/**
 * Manifest Validation API Route — POST /api/manifest/validate
 *
 * Validate a submitted manifest by verifying:
 * - Hash integrity
 * - Required fields
 * - Value constraints
 *
 * Request Body:
 *   - JSON serialized ProjectManifest object
 *
 * Response:
 *   - On success: { valid: boolean, errors: string[] }
 *   - On error: { error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { ProjectManifest, validateManifest } from '@/lib/project-manifest';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let manifest: ProjectManifest;

    try {
      manifest = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate the manifest
    const result = validateManifest(manifest);

    return NextResponse.json(
      {
        valid: result.valid,
        errors: result.errors,
      },
      { status: result.valid ? 200 : 400 }
    );
  } catch (error) {
    console.error('Manifest validation error:', error);

    return NextResponse.json(
      { error: 'Failed to validate manifest' },
      { status: 500 }
    );
  }
}
