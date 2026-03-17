/**
 * Generate a valid CarPlay access token for E2E tests.
 * Mirrors the HMAC-SHA256 token signing from src/lib/carplay-auth.ts.
 */
import { createHmac } from 'crypto';

function getSecret(): string {
  return process.env.CARPLAY_JWT_SECRET || 'test-jwt-secret-not-real';
}

export function generateTestCarPlayToken(deviceId = 'e2e-test-device'): string {
  const payload = {
    deviceId,
    type: 'access',
    iat: Date.now(),
    exp: Date.now() + 15 * 60 * 1000, // 15 minutes
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function carPlayHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${generateTestCarPlayToken()}` };
}
