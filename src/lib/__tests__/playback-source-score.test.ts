import {
  calculatePlaybackSourceScore,
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

    expect(complete - outdated).toBe(10);
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
});
