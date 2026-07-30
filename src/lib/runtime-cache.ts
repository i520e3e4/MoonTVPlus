/* eslint-disable no-console */

interface CacheNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
}

let namespacePromise: Promise<CacheNamespace | null> | null = null;

async function getNamespace(): Promise<CacheNamespace | null> {
  if (namespacePromise) return namespacePromise;
  namespacePromise = (async () => {
    if (typeof window !== 'undefined') return null;
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const context = await getCloudflareContext({ async: true });
      return (
        ((context.env as Record<string, unknown>).CACHE as
          | CacheNamespace
          | undefined) || null
      );
    } catch {
      return null;
    }
  })();
  return namespacePromise;
}

export async function getRuntimeCacheJson<T>(key: string): Promise<T | null> {
  const namespace = await getNamespace();
  if (!namespace) return null;
  try {
    return (await namespace.get(key, 'json')) as T | null;
  } catch (error) {
    console.warn('[RuntimeCache] read failed:', error);
    return null;
  }
}

export async function setRuntimeCacheJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const namespace = await getNamespace();
  if (!namespace) return;
  try {
    await namespace.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(30, Math.floor(ttlSeconds)),
    });
  } catch (error) {
    console.warn('[RuntimeCache] write failed:', error);
  }
}

