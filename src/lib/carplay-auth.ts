/**
 * @module carplay-auth
 * @description
 * Authentication middleware for CarPlay API endpoints.
 *
 * Uses HMAC-signed tokens (zero external dependencies) for a single-user
 * internal app. Token flow:
 * 1. Device pairs via POST /api/carplay/auth with shared secret
 * 2. Server issues access token (15min) + refresh token (30 days)
 * 3. All /api/carplay/* routes call verifyCarPlayToken() on each request
 * 4. On 401, client refreshes via POST /api/carplay/auth with refreshToken
 *
 * Tokens are HMAC-SHA256 signed JSON payloads (similar to JWT but zero-dep).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getJwtSecret(): string {
  const secret = process.env.CARPLAY_JWT_SECRET;
  if (!secret) throw new Error('CARPLAY_JWT_SECRET is not set');
  return secret;
}

function getDeviceSecret(): string {
  const secret = process.env.CARPLAY_DEVICE_SECRET;
  if (!secret) throw new Error('CARPLAY_DEVICE_SECRET is not set');
  return secret;
}

// ---------------------------------------------------------------------------
// Token encoding / verification (HMAC-SHA256 signed JSON)
// ---------------------------------------------------------------------------

interface TokenPayload {
  deviceId: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

function signToken(payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, sig] = parts;
  const expected = createHmac('sha256', getJwtSecret()).update(data).digest('base64url');

  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the Bearer token on a CarPlay API request.
 * Returns the decoded payload or null if invalid/expired.
 */
export async function verifyCarPlayToken(
  request: NextRequest
): Promise<{ deviceId: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'access') return null;

  // Touch lastUsedAt (fire-and-forget)
  prisma.deviceToken
    .update({
      where: { deviceId: payload.deviceId },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {}); // best-effort

  return { deviceId: payload.deviceId };
}

/**
 * Generate an access + refresh token pair for a device.
 * Stores hashed tokens in DeviceToken table.
 */
export async function generateTokenPair(deviceId: string) {
  const now = Date.now();

  const accessPayload: TokenPayload = {
    deviceId,
    type: 'access',
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_MS,
  };

  const refreshPayload: TokenPayload = {
    deviceId,
    type: 'refresh',
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_MS,
  };

  const accessToken = signToken(accessPayload);
  const refreshToken = signToken(refreshPayload);

  // Hash tokens for storage
  const tokenHash = createHmac('sha256', getJwtSecret())
    .update(accessToken)
    .digest('hex');
  const refreshTokenHash = createHmac('sha256', getJwtSecret())
    .update(refreshToken)
    .digest('hex');

  // Upsert device token record
  await prisma.deviceToken.upsert({
    where: { deviceId },
    update: {
      tokenHash,
      refreshTokenHash,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
      lastUsedAt: new Date(),
      revokedAt: null,
    },
    create: {
      deviceId,
      tokenHash,
      refreshTokenHash,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(accessPayload.exp).toISOString(),
  };
}

/**
 * Validate shared secret for initial device pairing.
 */
export function validateDeviceSecret(secret: string): boolean {
  const expected = getDeviceSecret();
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Refresh an access token using a valid refresh token.
 * Returns null if the refresh token is invalid or revoked.
 */
export async function refreshAccessToken(refreshToken: string) {
  const payload = verifyToken(refreshToken);
  if (!payload || payload.type !== 'refresh') return null;

  // Verify refresh token hash matches stored value
  const storedHash = createHmac('sha256', getJwtSecret())
    .update(refreshToken)
    .digest('hex');

  const device = await prisma.deviceToken.findUnique({
    where: { deviceId: payload.deviceId },
  });

  if (!device || device.revokedAt || device.refreshTokenHash !== storedHash) {
    return null;
  }

  // Issue new access token only (refresh token stays the same)
  const now = Date.now();
  const accessPayload: TokenPayload = {
    deviceId: payload.deviceId,
    type: 'access',
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_MS,
  };

  const accessToken = signToken(accessPayload);
  const newTokenHash = createHmac('sha256', getJwtSecret())
    .update(accessToken)
    .digest('hex');

  await prisma.deviceToken.update({
    where: { deviceId: payload.deviceId },
    data: { tokenHash: newTokenHash, lastUsedAt: new Date() },
  });

  return {
    accessToken,
    expiresAt: new Date(accessPayload.exp).toISOString(),
  };
}

/**
 * Log a CarPlay action to the audit trail + MessageLog.
 */
export async function auditLog(
  action: string,
  payload: unknown,
  deviceId: string
) {
  await Promise.all([
    prisma.carPlayAuditLog.create({
      data: {
        action,
        payload: payload as object,
        deviceId,
      },
    }),
    prisma.messageLog.create({
      data: {
        fromId: 'carplay',
        toId: 'dustin',
        channel: 'carplay',
        subject: action,
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        status: 'sent',
        metadata: { deviceId, action },
      },
    }),
  ]);
}

/**
 * Helper to create a 401 response for unauthenticated CarPlay requests.
 */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized — invalid or expired CarPlay token' },
    { status: 401 }
  );
}
