import {
  buildPlaybackProbeProxyUrl,
  probePlaybackSource,
} from '../playback-source-probe';

const measurement = {
  quality: '1080p',
  loadSpeed: '2 MB/s',
  pingTime: 80,
  bitrate: '4 Mbps',
  throughputKbps: 16000,
  sustainabilityRatio: 4,
  manifestMs: 80,
};

describe('playback source probe', () => {
  it('uses a segment proxy after a direct CORS-style failure', async () => {
    const urls: string[] = [];
    const probe = jest.fn(async (url: string) => {
      urls.push(url);
      if (urls.length === 1)
        throw new Error('HLS networkError/manifestLoadError');
      return measurement;
    });

    const result = await probePlaybackSource({
      url: 'https://media.example.com/index.m3u8',
      sourceKey: 'jinying',
      timeoutMs: 4000,
      probe,
    });

    expect(result.probeMode).toBe('proxy');
    expect(result.fallbackUsed).toBe(true);
    expect(urls[1]).toContain('/api/proxy-m3u8?');
    expect(urls[1]).toContain('segments=1');
  });

  it('uses the configured VOD proxy immediately for proxy-mode sources', async () => {
    const probe = jest.fn(async (_url: string) => measurement);
    await probePlaybackSource({
      url: 'https://media.example.com/index.m3u8',
      sourceKey: 'jinying',
      timeoutMs: 4000,
      proxyMode: true,
      probe,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toContain('/api/proxy/vod/m3u8?');
  });

  it('reports both direct and proxy failures', async () => {
    const probe = jest
      .fn()
      .mockRejectedValueOnce(new Error('manifest CORS'))
      .mockRejectedValueOnce(new Error('proxy HTTP 502'));

    await expect(
      probePlaybackSource({
        url: 'https://media.example.com/index.m3u8',
        sourceKey: 'jinying',
        timeoutMs: 4000,
        probe,
      })
    ).rejects.toThrow('直连失败：manifest CORS；代理失败：proxy HTTP 502');
  });

  it('does not double-wrap an existing proxy URL', () => {
    const url = '/api/proxy-m3u8?url=x&source=a&segments=1';
    expect(buildPlaybackProbeProxyUrl({ url, sourceKey: 'a' })).toBe(url);
  });
});
