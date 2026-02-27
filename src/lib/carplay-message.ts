/**
 * @module carplay-message
 * @description
 * Two-output message handler for CarPlay/Siri → Rocket communication.
 *
 * When a message is sent from CarPlay or Siri, it is forwarded to Rocket
 * via the OpenClaw gateway with metadata requesting a two-output response:
 *   - [CARPLAY] — short digest (≤480 chars) shown on the car display
 *   - [FULL] — detailed response stored in message timeline + sent to Discord
 *
 * If Rocket does not produce the two-output format, the handler falls back
 * to truncating the full response for the CarPlay digest.
 */

import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SendResult {
  carplayDigest: string;
  fullText: string;
  messageId: string;
}

interface ParsedResponse {
  carplay: string;
  full: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a message to Rocket and return the two-output response.
 * Stores the message + response in MessageLog.
 */
export async function sendToRocket(
  text: string,
  source: 'carplay' | 'siri'
): Promise<SendResult> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN;

  // Log outbound message
  const outbound = await prisma.messageLog.create({
    data: {
      fromId: source,
      toId: 'rocket',
      channel: 'carplay',
      subject: `CarPlay message (${source})`,
      body: text,
      status: 'sent',
      metadata: {
        source,
        reply_style: 'carplay_digest',
        max_chars: 480,
        needs_two_outputs: true,
      },
    },
  });

  if (!gatewayUrl || !hooksToken) {
    // Dry-run: no gateway configured
    console.warn('[CarPlay Message] OpenClaw hooks not configured, dry-run mode');

    const dryResponse = `[CARPLAY]\n- Status: Gateway offline (dry-run)\n- Next: Configure OPENCLAW_GATEWAY_URL\n\n[FULL]\nThe OpenClaw gateway is not configured. Set OPENCLAW_GATEWAY_URL and OPENCLAW_HOOKS_TOKEN in your environment.`;

    const parsed = parseRocketResponse(dryResponse);
    await logResponse(outbound.id, parsed, source);

    return {
      carplayDigest: parsed.carplay,
      fullText: parsed.full,
      messageId: outbound.id,
    };
  }

  try {
    // Call OpenClaw hooks/wake (same pattern as POST /api/kick)
    const response = await fetch(`${gatewayUrl}/hooks/wake`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hooksToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        mode: 'now',
        metadata: {
          source,
          reply_style: 'carplay_digest',
          max_chars: 480,
          needs_two_outputs: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CarPlay Message] Gateway error:', response.status, errorText);

      await prisma.messageLog.update({
        where: { id: outbound.id },
        data: {
          status: 'failed',
          metadata: {
            source,
            error: errorText,
            httpStatus: response.status,
          },
        },
      });

      return {
        carplayDigest: 'Failed to reach Rocket. Try again later.',
        fullText: `Gateway error (${response.status}): ${errorText}`,
        messageId: outbound.id,
      };
    }

    const result = await response.json();
    const responseText =
      typeof result === 'string'
        ? result
        : result.response ?? result.text ?? JSON.stringify(result);

    const parsed = parseRocketResponse(responseText);
    await logResponse(outbound.id, parsed, source);

    return {
      carplayDigest: parsed.carplay,
      fullText: parsed.full,
      messageId: outbound.id,
    };
  } catch (error) {
    console.error('[CarPlay Message] Error:', error);

    return {
      carplayDigest: 'Error communicating with Rocket.',
      fullText: error instanceof Error ? error.message : 'Unknown error',
      messageId: outbound.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Rocket response that may contain [CARPLAY] and [FULL] sections.
 * Falls back to truncation if markers are not present.
 */
export function parseRocketResponse(response: string): ParsedResponse {
  const carplayIdx = response.indexOf('[CARPLAY]');
  const fullIdx = response.indexOf('[FULL]');

  if (carplayIdx !== -1 && fullIdx !== -1) {
    const carplay = response
      .slice(carplayIdx + '[CARPLAY]'.length, fullIdx)
      .trim();
    const full = response.slice(fullIdx + '[FULL]'.length).trim();
    return { carplay, full };
  }

  if (carplayIdx !== -1) {
    // Only [CARPLAY] marker — rest is full
    const carplay = response.slice(carplayIdx + '[CARPLAY]'.length).trim();
    return { carplay: carplay.slice(0, 480), full: response };
  }

  // No markers — truncate for CarPlay
  const truncated =
    response.length > 480 ? response.slice(0, 477) + '...' : response;
  return { carplay: truncated, full: response };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logResponse(
  outboundId: string,
  parsed: ParsedResponse,
  source: string
) {
  await prisma.messageLog.create({
    data: {
      fromId: 'rocket',
      toId: source,
      channel: 'carplay',
      subject: 'Rocket response',
      body: parsed.full,
      status: 'delivered',
      metadata: {
        source,
        carplay_digest: parsed.carplay,
        full_text: parsed.full,
        inReplyTo: outboundId,
      },
    },
  });
}
