const encoder = new TextEncoder();

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value)
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function createProxyToken(
  secret: string,
  ttlSeconds = 300
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + Math.min(900, ttlSeconds);
  const signature = await hmacHex(`proxy:${expires}`, secret);
  return `${expires}.${signature}`;
}

export async function verifyProxyToken(
  token: string,
  secret: string
): Promise<boolean> {
  const [expiresText, signature] = token.split('.', 2);
  const expires = Number(expiresText);
  if (
    !Number.isInteger(expires) ||
    !signature ||
    expires < Math.floor(Date.now() / 1000) ||
    expires > Math.floor(Date.now() / 1000) + 900
  ) {
    return false;
  }
  const expected = await hmacHex(`proxy:${expires}`, secret);
  return timingSafeEqual(signature, expected);
}

