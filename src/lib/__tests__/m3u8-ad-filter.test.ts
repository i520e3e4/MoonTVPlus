import {
  AdFilterRule,
  filterM3u8Ads,
} from '@/lib/m3u8-ad-filter';

const sample = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:5,
https://cdn.example/video-1.ts
#EXT-X-DISCONTINUITY
#EXTINF:4,
https://ads.example/pre-roll/ad-1.ts
#EXTINF:5,
https://cdn.example/video-2.ts
#EXT-X-ENDLIST`;

describe('M3U8 ad filter', () => {
  it('removes high confidence ad segments and preserves discontinuities', () => {
    const result = filterM3u8Ads({ content: sample });

    expect(result.removedSegments).toBe(1);
    expect(result.content).not.toContain('ad-1.ts');
    expect(result.content).toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).toContain('video-2.ts');
  });

  it('supports source-specific blocked domains', () => {
    const rules: AdFilterRule[] = [
      {
        sourceKey: 'source-a',
        blockedDomains: ['commercial.example'],
        pathPatterns: [],
        maxIntroAdSeconds: 0,
        removeScte35: false,
        enabled: true,
      },
    ];
    const content = `#EXTM3U
#EXTINF:5,
https://commercial.example/segment.ts
#EXTINF:5,
https://video.example/main.ts`;
    const result = filterM3u8Ads({
      sourceKey: 'source-a',
      content,
      rules,
    });

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('main.ts');
  });

  it('falls back to the original playlist if filtering removes every segment', () => {
    const content = `#EXTM3U
#EXTINF:4,
https://ads.example/ad/one.ts`;
    const result = filterM3u8Ads({ content });

    expect(result.fellBack).toBe(true);
    expect(result.content).toBe(content);
  });

  it('recognizes SCTE cue blocks without deleting legitimate metadata', () => {
    const content = `#EXTM3U
#EXT-X-CUE-OUT:10
#EXTINF:5,
https://cdn.example/commercial-1.ts
#EXT-X-CUE-IN
#EXT-X-DISCONTINUITY
#EXTINF:5,
https://cdn.example/main.ts`;
    const result = filterM3u8Ads({ content });

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('#EXT-X-CUE-OUT');
    expect(result.content).toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).toContain('main.ts');
  });
});

