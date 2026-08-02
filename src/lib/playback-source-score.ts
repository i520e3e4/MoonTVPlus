export interface PlaybackProbeResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
}

export interface PlaybackSourceScoreInput {
  testResult: PlaybackProbeResult;
  maxSpeedKBps: number;
  minPingMs: number;
  maxPingMs: number;
  episodeCount: number;
  maxEpisodeCount: number;
  configuredWeight?: number;
}

const QUALITY_SCORES: Record<string, number> = {
  '4K': 100,
  '2K': 85,
  '1080p': 75,
  '720p': 60,
  '480p': 40,
  SD: 20,
};

export function parseLoadSpeedKBps(loadSpeed: string): number | null {
  const match = loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  return match[2].toUpperCase() === 'MB/S' ? value * 1024 : value;
}

export function calculatePlaybackSourceScore({
  testResult,
  maxSpeedKBps,
  minPingMs,
  maxPingMs,
  episodeCount,
  maxEpisodeCount,
  configuredWeight = 0,
}: PlaybackSourceScoreInput): number {
  const qualityScore = QUALITY_SCORES[testResult.quality] ?? 0;

  const speedKBps = parseLoadSpeedKBps(testResult.loadSpeed);
  const speedScore =
    speedKBps === null || maxSpeedKBps <= 0
      ? 30
      : Math.min(100, Math.max(0, (speedKBps / maxSpeedKBps) * 100));

  const pingScore = (() => {
    if (testResult.pingTime <= 0) return 0;
    if (maxPingMs <= minPingMs) return 100;

    return Math.min(
      100,
      Math.max(
        0,
        ((maxPingMs - testResult.pingTime) / (maxPingMs - minPingMs)) * 100
      )
    );
  })();

  const isSeries = maxEpisodeCount > 1;
  const episodeCoverageScore = isSeries
    ? Math.min(100, Math.max(0, (episodeCount / maxEpisodeCount) * 100))
    : 100;

  const score = isSeries
    ? qualityScore * 0.3 +
      speedScore * 0.3 +
      pingScore * 0.15 +
      episodeCoverageScore * 0.25
    : qualityScore * 0.4 + speedScore * 0.4 + pingScore * 0.2;

  return Math.round((score + configuredWeight) * 100) / 100;
}
