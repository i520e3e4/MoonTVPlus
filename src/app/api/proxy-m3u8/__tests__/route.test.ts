import { Headers, Request, Response } from 'node-fetch';

Object.assign(global, { Headers, Request, Response });

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ SiteConfig: {} }),
}));
jest.mock('@/lib/server/ssrf', () => ({
  validateProxyUrlServerSide: jest.fn().mockResolvedValue(true),
}));

let GET: typeof import('../route').GET;

beforeAll(async () => {
  ({ GET } = await import('../route'));
});

describe('proxy-m3u8 link rewriting', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000',
    'variant/index.m3u8',
    '#EXTINF:10,',
    'segments/001.ts',
  ].join('\n');

  const requestPlaylist = async (segments: boolean) => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(playlist, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    );

    const query = new URLSearchParams({
      url: 'https://media.example.com/show/master.m3u8',
      source: 'source-a',
    });
    if (segments) query.set('segments', '1');

    const request = new Request(
      `https://moon.example.com/api/proxy-m3u8?${query}`
    ) as unknown as Parameters<typeof GET>[0];
    const response = await GET(request);
    return response.text();
  };

  it('keeps media segments direct in manifest-only proxy mode', async () => {
    const result = await requestPlaylist(false);

    expect(result).toContain(
      'https://media.example.com/show/segments/001.ts'
    );
    expect(result).not.toContain('/api/proxy/vod/segment?url=');
    expect(result).not.toContain('segments=1');
  });

  it('rewrites keys, child manifests, and media segments in full proxy mode', async () => {
    const result = await requestPlaylist(true);

    expect(result).toContain(
      'URI="https://moon.example.com/api/proxy/vod/segment?url='
    );
    expect(result).toContain('/api/proxy-m3u8?url=');
    expect(result).toContain('&segments=1');
    expect(result).toContain('/api/proxy/vod/segment?url=');
    expect(result).not.toContain(
      '\nhttps://media.example.com/show/segments/001.ts'
    );
  });
});
