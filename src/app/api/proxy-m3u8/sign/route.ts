import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { createProxyToken } from '@/lib/proxy-signature';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.PROXY_M3U8_TOKEN || process.env.PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: 'Proxy signing secret is not configured' },
      { status: 503 }
    );
  }

  const token = await createProxyToken(secret, 300);
  return NextResponse.json({
    token,
    expiresAt: Number(token.split('.')[0]) * 1000,
  });
}

