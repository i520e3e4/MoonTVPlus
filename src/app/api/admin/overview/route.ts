import { NextRequest, NextResponse } from 'next/server';

import { isOwnerRequest } from '@/lib/admin-auth';
import { getAvailableApiSites } from '@/lib/config';
import { getSourceOverview } from '@/lib/source-health-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [overview, availableSources] = await Promise.all([
    getSourceOverview(),
    getAvailableApiSites(process.env.USERNAME),
  ]);

  return NextResponse.json(
    {
      ...overview,
      configuredSources: availableSources.length,
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

