import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthenticatedUsername } from '@/lib/admin-auth';
import { recordPlaybackTelemetry } from '@/lib/source-health-store';

export const runtime = 'nodejs';

const playbackSchema = z.object({
  sessionId: z.string().min(8).max(100),
  sourceKey: z.string().min(1).max(160),
  deviceType: z
    .enum(['web', 'tv', 'orion', 'tvbox', 'unknown'])
    .default('unknown'),
  success: z.boolean(),
  startupMs: z.number().int().min(0).max(120000).optional(),
  bufferingCount: z.number().int().min(0).max(1000).optional(),
  playedSeconds: z.number().int().min(0).max(86400).optional(),
  completed: z.boolean().optional(),
  manualSelection: z.boolean().optional(),
  adSegments: z.number().int().min(0).max(1000).optional(),
  failureReason: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const username = getAuthenticatedUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = playbackSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid telemetry payload' },
      { status: 400 }
    );
  }

  try {
    await recordPlaybackTelemetry({ username, telemetry: parsed.data });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[Telemetry] Failed to record playback:', error);
    return NextResponse.json({ error: 'Telemetry unavailable' }, { status: 503 });
  }
}

