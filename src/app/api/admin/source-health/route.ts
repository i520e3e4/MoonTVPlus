import { NextRequest, NextResponse } from 'next/server';

import { isOwnerRequest } from '@/lib/admin-auth';
import { getAvailableApiSites } from '@/lib/config';
import { getSourceHealthMap } from '@/lib/source-health-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sites = await getAvailableApiSites(process.env.USERNAME, true);
  const healthMap = await getSourceHealthMap(sites.map((site) => site.key));
  const now = Date.now();
  const sources = sites
    .map((site) => {
      const health = healthMap.get(site.key);
      return {
        key: site.key,
        name: site.name,
        api: site.api,
        healthScore: health?.healthScore ?? 60,
        p50LatencyMs: health?.p50LatencyMs ?? 0,
        p95LatencyMs: health?.p95LatencyMs ?? 0,
        searchSuccessCount: health?.searchSuccessCount ?? 0,
        searchFailureCount: health?.searchFailureCount ?? 0,
        playbackSuccessCount: health?.playbackSuccessCount ?? 0,
        playbackFailureCount: health?.playbackFailureCount ?? 0,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        averageStartupMs: health?.averageStartupMs ?? 0,
        bufferingCount: health?.bufferingCount ?? 0,
        adSegments: health?.adSegments ?? 0,
        circuitOpenUntil: health?.circuitOpenUntil ?? null,
        circuitOpen: Boolean(
          health?.circuitOpenUntil && health.circuitOpenUntil > now
        ),
        updatedAt: health?.updatedAt ?? null,
      };
    })
    .sort((a, b) => b.healthScore - a.healthScore);

  return NextResponse.json(
    { sources, generatedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

