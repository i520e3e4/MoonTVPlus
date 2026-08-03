import type { PlaybackProbeResult } from '@/lib/playback-source-score';

export interface DetailedPlaybackProbeResult extends PlaybackProbeResult {
  bitrate: string;
  throughputKbps: number;
  sustainabilityRatio: number;
  manifestMs: number;
  probeMode: 'direct' | 'proxy';
  fallbackUsed: boolean;
}

export type PlaybackProbe = (
  url: string,
  timeoutMs: number
) => Promise<Omit<DetailedPlaybackProbeResult, 'probeMode' | 'fallbackUsed'>>;

function isLikelyHlsUrl(url: string): boolean {
  return (
    url.toLowerCase().includes('.m3u') ||
    !/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/i.test(url)
  );
}

export function buildPlaybackProbeProxyUrl(params: {
  url: string;
  sourceKey: string;
  proxyMode?: boolean;
  proxyToken?: string;
}): string {
  const { url, sourceKey, proxyMode = false, proxyToken } = params;
  if (url.includes('/api/proxy-m3u8') || url.includes('/api/proxy/vod/m3u8')) {
    return url;
  }

  if (proxyMode) {
    return `/api/proxy/vod/m3u8?url=${encodeURIComponent(
      url
    )}&source=${encodeURIComponent(sourceKey)}`;
  }

  const tokenParam = proxyToken
    ? `&token=${encodeURIComponent(proxyToken)}`
    : '';
  return `/api/proxy-m3u8?url=${encodeURIComponent(
    url
  )}&source=${encodeURIComponent(sourceKey)}&segments=1${tokenParam}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '未知错误';
}

export async function probePlaybackSource(params: {
  url: string;
  sourceKey: string;
  timeoutMs: number;
  proxyMode?: boolean;
  proxyToken?: string;
  probe: PlaybackProbe;
}): Promise<DetailedPlaybackProbeResult> {
  const {
    url,
    sourceKey,
    timeoutMs,
    proxyMode = false,
    proxyToken,
    probe,
  } = params;
  const shouldUseProxyFirst =
    proxyMode ||
    url.includes('/api/proxy-m3u8') ||
    url.includes('/api/proxy/vod/m3u8');

  if (!isLikelyHlsUrl(url) || shouldUseProxyFirst) {
    const probeUrl = shouldUseProxyFirst
      ? buildPlaybackProbeProxyUrl({ url, sourceKey, proxyMode, proxyToken })
      : url;
    const result = await probe(probeUrl, timeoutMs);
    return {
      ...result,
      probeMode: shouldUseProxyFirst ? 'proxy' : 'direct',
      fallbackUsed: false,
    };
  }

  try {
    const result = await probe(url, timeoutMs);
    return { ...result, probeMode: 'direct', fallbackUsed: false };
  } catch (directError) {
    const proxyUrl = buildPlaybackProbeProxyUrl({
      url,
      sourceKey,
      proxyToken,
    });
    try {
      const result = await probe(proxyUrl, timeoutMs);
      return { ...result, probeMode: 'proxy', fallbackUsed: true };
    } catch (proxyError) {
      throw new Error(
        `直连失败：${errorMessage(directError)}；代理失败：${errorMessage(
          proxyError
        )}`
      );
    }
  }
}
