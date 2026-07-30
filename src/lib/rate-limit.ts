interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(params.key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + params.windowMs }
      : existing;

  bucket.count += 1;
  buckets.set(params.key, bucket);

  if (buckets.size > 5000) {
    buckets.forEach((value, key) => {
      if (value.resetAt <= now) buckets.delete(key);
    });
  }

  return {
    allowed: bucket.count <= params.limit,
    remaining: Math.max(0, params.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}
