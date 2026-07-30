import {
  createProxyToken,
  verifyProxyToken,
} from '@/lib/proxy-signature';

describe('proxy signatures', () => {
  it('creates short-lived tokens that validate with the same secret', async () => {
    const token = await createProxyToken('test-secret', 120);

    await expect(verifyProxyToken(token, 'test-secret')).resolves.toBe(true);
    await expect(verifyProxyToken(token, 'wrong-secret')).resolves.toBe(false);
  });

  it('rejects malformed and expired tokens', async () => {
    await expect(
      verifyProxyToken('not-a-token', 'test-secret')
    ).resolves.toBe(false);
    await expect(
      verifyProxyToken('1.deadbeef', 'test-secret')
    ).resolves.toBe(false);
  });
});

