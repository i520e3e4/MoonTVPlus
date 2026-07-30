import { NextRequest, NextResponse } from 'next/server';

import { isOwnerRequest } from '@/lib/admin-auth';
import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  recordSearchObservations,
  SearchObservation,
} from '@/lib/source-health-store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    keys?: string[];
    query?: string;
  };
  const requestedKeys = Array.isArray(body.keys)
    ? body.keys.filter((key) => typeof key === 'string').slice(0, 12)
    : [];
  if (requestedKeys.length === 0) {
    return NextResponse.json(
      { error: 'keys must contain 1-12 source keys' },
      { status: 400 }
    );
  }

  const query =
    typeof body.query === 'string' && body.query.trim()
      ? body.query.trim().slice(0, 80)
      : '斗罗大陆';
  const allSites = await getAvailableApiSites(process.env.USERNAME, true);
  const sites = allSites.filter((site) => requestedKeys.includes(site.key));
  const observations: SearchObservation[] = [];

  const results = await Promise.all(
    sites.map(async (site) => {
      const startedAt = Date.now();
      try {
        const searchResults = await searchFromApi(site, query);
        const observation = {
          sourceKey: site.key,
          success: true,
          timeout: false,
          latencyMs: Date.now() - startedAt,
          resultCount: searchResults.length,
        };
        observations.push(observation);
        return observation;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const observation = {
          sourceKey: site.key,
          success: false,
          timeout: /timeout|abort/i.test(message),
          latencyMs: Date.now() - startedAt,
          resultCount: 0,
        };
        observations.push(observation);
        return observation;
      }
    })
  );

  await recordSearchObservations(observations);
  return NextResponse.json({ results });
}

