import type { ApiSite } from '@/lib/config';
import {
  calculateHealthScore,
  progressiveSearch,
  rankSources,
} from '@/lib/source-selection';

function createSites(count: number): ApiSite[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `source-${index + 1}`,
    name: `Source ${index + 1}`,
    api: `https://source-${index + 1}.example/api`,
  }));
}

describe('source selection', () => {
  it('never selects more than 12 candidates from a large configuration', () => {
    const ranked = rankSources({
      sites: createSites(72),
      query: 'test',
      maxCandidates: 12,
    });

    expect(ranked).toHaveLength(12);
    expect(new Set(ranked.map((item) => item.site.key)).size).toBe(12);
  });

  it('excludes an open circuit while healthy sources are available', () => {
    const sites = createSites(3);
    const now = Date.now();
    const ranked = rankSources({
      sites,
      now,
      maxCandidates: 2,
      healthByKey: new Map([
        [
          'source-1',
          {
            sourceKey: 'source-1',
            healthScore: 99,
            circuitOpenUntil: now + 60_000,
          } as any,
        ],
      ]),
    });

    expect(ranked.map((item) => item.site.key)).not.toContain('source-1');
  });

  it('gives better health to reliable and fast sources', () => {
    const reliable = calculateHealthScore({
      searchSuccessCount: 90,
      searchFailureCount: 10,
      playbackSuccessCount: 95,
      playbackFailureCount: 5,
      p50LatencyMs: 400,
      p95LatencyMs: 1000,
    });
    const unreliable = calculateHealthScore({
      searchSuccessCount: 20,
      searchFailureCount: 80,
      playbackSuccessCount: 30,
      playbackFailureCount: 70,
      timeoutCount: 15,
      p50LatencyMs: 5000,
      p95LatencyMs: 8000,
    });

    expect(reliable).toBeGreaterThan(unreliable);
    expect(reliable).toBeGreaterThan(75);
  });

  it('searches in waves and stops when enough results are found', async () => {
    const sources = rankSources({
      sites: createSites(12),
      maxCandidates: 12,
    });
    const searched: string[] = [];
    const { results, attempted } = await progressiveSearch({
      sources,
      search: async (source) => {
        searched.push(source.site.key);
        return [{ source: source.site.key }, { source: source.site.key }];
      },
      options: {
        batchSize: 4,
        enoughResults: 6,
        batchTimeoutMs: 1000,
      },
    });

    expect(results).toHaveLength(8);
    expect(attempted).toHaveLength(4);
    expect(searched).toHaveLength(4);
  });

  it('enforces the timeout even when a downstream client ignores abort', async () => {
    const sources = rankSources({
      sites: createSites(1),
      maxCandidates: 1,
    });
    const startedAt = Date.now();
    const { results } = await progressiveSearch({
      sources,
      search: async () => new Promise<never>(() => undefined),
      options: { batchSize: 1, batchTimeoutMs: 20 },
    });

    expect(results).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
