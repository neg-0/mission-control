/**
 * POST /api/carplay/auth
 *
 * Two endpoints in one file:
 *
 * 1. **Device pairing** (body has `deviceId` + `secret`):
 *    Validates the shared secret and issues an access + refresh token pair.
 *
 * 2. **Token refresh** (body has `refreshToken`):
 *    Validates the refresh token and issues a new access token.
 *
 * Auth is NOT required on this route (it IS the login endpoint).
 */

import {
  generateTokenPair,
  validateDeviceSecret,
  refreshAccessToken,
} from '@/lib/carplay-auth';
import {
  CarPlayAuthSchema,
  CarPlayRefreshSchema,
  formatZodError,
} from '@/lib/schemas';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Route 1: Token refresh
    if ('refreshToken' in body) {
      const result = CarPlayRefreshSchema.safeParse(body);
      if (!result.success) {
        return NextResponse.json(formatZodError(result.error), { status: 400 });
      }

      const tokens = await refreshAccessToken(result.data.refreshToken);
      if (!tokens) {
        return NextResponse.json(
          { error: 'Invalid or expired refresh token' },
          { status: 401 }
        );
      }

      return NextResponse.json(tokens);
    }

    // Route 2: Initial device pairing
    const result = CarPlayAuthSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { deviceId, secret } = result.data;

    if (!validateDeviceSecret(secret)) {
      return NextResponse.json(
        { error: 'Invalid device secret' },
        { status: 403 }
      );
    }

    const tokens = await generateTokenPair(deviceId);
    return NextResponse.json(tokens, { status: 201 });
  } catch (e) {
    console.error('[CarPlay Auth]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
