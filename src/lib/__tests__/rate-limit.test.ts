import { checkRateLimit } from '@/lib/rate-limit';

describe('rate limit', () => {
  it('blocks calls above the configured window quota', () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    expect(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed).toBe(
      true
    );
    expect(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed).toBe(
      true
    );
    const blocked = checkRateLimit({ key, limit: 2, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

