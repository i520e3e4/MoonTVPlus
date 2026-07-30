import { NextRequest, NextResponse } from 'next/server';

import { isOwnerRequest } from '@/lib/admin-auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import {
  getSourceHealthMap,
  getUserSourcePreferenceMap,
} from '@/lib/source-health-store';
import { rankSources } from '@/lib/source-selection';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get('q') || '';
  const username =
    new URL(request.url).searchParams.get('username') || process.env.USERNAME || '';
  const [sites, config] = await Promise.all([
    getAvailableApiSites(username, true),
    getConfig(),
  ]);
  const [healthByKey, preferenceByKey] = await Promise.all([
    getSourceHealthMap(sites.map((site) => site.key)),
    getUserSourcePreferenceMap(username),
  ]);
  const configuredWeightByKey = new Map(
    config.SourceConfig.map((source) => [source.key, source.weight || 0])
  );
  const ranked = rankSources({
    sites,
    healthByKey,
    preferenceByKey,
    configuredWeightByKey,
    query,
    maxCandidates: 12,
  });

  return NextResponse.json({
    query,
    username,
    candidates: ranked.map((source, index) => ({
      rank: index + 1,
      key: source.site.key,
      name: source.site.name,
      score: source.score,
      reasons: source.reasons,
      exploration: source.exploration,
      circuitOpen: source.circuitOpen,
    })),
  });
}

