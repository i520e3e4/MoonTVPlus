import { NextRequest, NextResponse } from 'next/server';

import { isOwnerRequest } from '@/lib/admin-auth';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import {
  getConfigVersion,
  listConfigVersions,
  recordConfigVersion,
} from '@/lib/source-health-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const versions = await listConfigVersions(30);
  return NextResponse.json({
    versions: versions.map(({ config: _config, ...version }) => version),
  });
}

export async function POST(request: NextRequest) {
  if (!isOwnerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    id?: string;
  } | null;
  if (!body?.id) {
    return NextResponse.json({ error: 'Missing version id' }, { status: 400 });
  }

  const version = await getConfigVersion(body.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }

  const current = await getConfig();
  await recordConfigVersion({
    config: current,
    changedBy: process.env.USERNAME || 'owner',
    changeSummary: `自动备份：恢复 ${version.id} 前`,
  });
  const restored = configSelfCheck(JSON.parse(version.config));
  const { db } = await import('@/lib/db');
  await db.saveAdminConfig(restored);
  await setCachedConfig(restored);
  return NextResponse.json({ success: true, restoredVersion: version.id });
}

