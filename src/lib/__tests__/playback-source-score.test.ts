import {
  calculateAbsolutePingScore,
  calculateAbsoluteSpeedScore,
  calculatePlaybackSourceScore,
  calculateSustainabilityScore,
  parseBitrateKbps,
  parseLoadSpeedKBps,
} from '../playback-source-score';

describe('playback source scoring', () => {
  it('normalizes KB/s and MB/s', () => {
    expect(parseLoadSpeedKBps('768 KB/s')).toBe(768);
    expect(parseLoadSpeedKBps('1.5 MB/s')).toBe(1536);
    expect(parseLoadSpeedKBps('未知')).toBeNull();
  });

  it('normalizes Kbps and Mbps bitrates', () => {
    expect(parseBitrateKbps('850 Kbps')).toBe(850);
    expect(parseBitrateKbps('2.5 Mbps')).toBe(2500);
    expect(parseBitrateKbps('未知')).toBeNull();
  });

  it('does not treat the fastest source as fast when every source is slow', () => {
    expect(calculateAbsoluteSpeedScore(64)).toBeLessThan(10);
    expect(calculateAbsoluteSpeedScore(2048)).toBeGreaterThanOrEqual(85);
    expect(calculateAbsolutePingScore(2000)).toBeLessThan(20);
  });

  it('requires enough throughput headroom for the advertised bitrate', () => {
    expect(calculateSustainabilityScore(0.7)).toBeLessThan(10);
    expect(calculateSustainabilityScore(1)).toBe(25);
    expect(calculateSustainabilityScore(2)).toBe(80);
    expect(calculateSustainabilityScore(3)).toBe(100);
  });

  it('prefers the faster source when movie quality is equal', () => {
    const common = {
      maxSpeedKBps: 2048,
      minPingMs: 80,
      maxPingMs: 300,
      episodeCount: 1,
      maxEpisodeCount: 1,
    };

    const fast = calculatePlaybackSourceScore({
      ...common,
      testResult: { quality: '1080p', loadSpeed: '2 MB/s', pingTime: 80 },
    });
    const slow = calculatePlaybackSourceScore({
      ...common,
      testResult: { quality: '1080p', loadSpeed: '512 KB/s', pingTime: 300 },
    });

    expect(fast).toBeGreaterThan(slow);
  });

  it('includes episode completeness for series source selection', () => {
    const common = {
      testResult: { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 100 },
      maxSpeedKBps: 1024,
      minPingMs: 100,
      maxPingMs: 100,
      maxEpisodeCount: 40,
    };

    const complete = calculatePlaybackSourceScore({
      ...common,
      episodeCount: 40,
    });
    const outdated = calculatePlaybackSourceScore({
      ...common,
      episodeCount: 20,
    });

    expect(complete - outdated).toBe(8);
  });

  it('uses historical reliability to avoid a fast but unstable source', () => {
    const common = {
      maxSpeedKBps: 2048,
      minPingMs: 50,
      maxPingMs: 300,
      maxBitrateKbps: 4000,
      episodeCount: 1,
      maxEpisodeCount: 1,
    };
    const unstable = calculatePlaybackSourceScore({
      ...common,
      testResult: {
        quality: '1080p',
        bitrate: '4 Mbps',
        loadSpeed: '2 MB/s',
        pingTime: 50,
      },
      historicalHealthScore: 20,
    });
    const reliable = calculatePlaybackSourceScore({
      ...common,
      testResult: {
        quality: '1080p',
        bitrate: '3 Mbps',
        loadSpeed: '1.5 MB/s',
        pingTime: 100,
      },
      historicalHealthScore: 95,
    });

    expect(reliable).toBeGreaterThan(unstable);
  });

  it('prefers sustainable HD over unsustainable high-bitrate video', () => {
    const common = {
      maxSpeedKBps: 2048,
      minPingMs: 80,
      maxPingMs: 120,
      maxBitrateKbps: 8000,
      episodeCount: 1,
      maxEpisodeCount: 1,
      historicalHealthScore: 70,
    };
    const unsustainable4k = calculatePlaybackSourceScore({
      ...common,
      testResult: {
        quality: '4K',
        bitrate: '8 Mbps',
        loadSpeed: '700 KB/s',
        pingTime: 80,
        sustainabilityRatio: 0.7,
      },
    });
    const sustainable1080p = calculatePlaybackSourceScore({
      ...common,
      testResult: {
        quality: '1080p',
        bitrate: '4 Mbps',
        loadSpeed: '2 MB/s',
        pingTime: 120,
        sustainabilityRatio: 4.1,
      },
    });
    expect(sustainable1080p).toBeGreaterThan(unsustainable4k);
  });
});
