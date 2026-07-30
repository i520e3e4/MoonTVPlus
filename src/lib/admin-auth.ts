import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from './auth';

export function getAuthenticatedUsername(request: NextRequest): string | null {
  return getAuthInfoFromCookie(request)?.username || null;
}

export function isOwnerRequest(request: NextRequest): boolean {
  const username = getAuthenticatedUsername(request);
  return Boolean(username && username === process.env.USERNAME);
}

