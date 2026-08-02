export interface PlaybackProbeResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate?: string;
}

export interface PlaybackSourceScoreInput {
  testResult: PlaybackProbeResult;
  maxSpeedKBps: number;
  minPingMs: number;
  maxPingMs: number;
  maxBitrateKbps?: number;
  episodeCount: number;
  maxEpisodeCount: number;
  historicalHealthScore?: number;
  preferenceScore?: number;
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

export function parseBitrateKbps(bitrate?: string): number | null {
  if (!bitrate) return null;
  const match = bitrate.match(/^([\d.]+)\s*(Kbps|Mbps)$/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2].toLowerCase() === 'mbps' ? value * 1000 : value;
}

export function calculatePlaybackSourceScore({
  testResult,
  maxSpeedKBps,
  minPingMs,
  maxPingMs,
  maxBitrateKbps = 0,
  episodeCount,
  maxEpisodeCount,
  historicalHealthScore = 55,
  preferenceScore = 0,
  configuredWeight = 0,
}: PlaybackSourceScoreInput): number {
  // Unknown metadata is neutral rather than fatal: some otherwise healthy
  // signed/native streams cannot expose resolution before playback starts.
  const qualityScore = QUALITY_SCORES[testResult.quality] ?? 45;

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

  const bitrateKbps = parseBitrateKbps(testResult.bitrate);
  const bitrateScore =
    bitrateKbps === null || maxBitrateKbps <= 0
      ? 45
      : Math.min(100, Math.max(0, (bitrateKbps / maxBitrateKbps) * 100));
  const reliabilityScore = Math.min(100, Math.max(0, historicalHealthScore));

  const isSeries = maxEpisodeCount > 1;
  const episodeCoverageScore = isSeries
    ? Math.min(100, Math.max(0, (episodeCount / maxEpisodeCount) * 100))
    : 100;

  const score = isSeries
    ? qualityScore * 0.22 +
      bitrateScore * 0.08 +
      speedScore * 0.2 +
      pingScore * 0.1 +
      reliabilityScore * 0.2 +
      episodeCoverageScore * 0.2
    : qualityScore * 0.25 +
      bitrateScore * 0.1 +
      speedScore * 0.25 +
      pingScore * 0.1 +
      reliabilityScore * 0.3;

  const configuredBonus = Math.min(10, Math.max(-10, configuredWeight));
  const preferenceBonus = Math.min(8, Math.max(-8, preferenceScore));
  return Math.round((score + configuredBonus + preferenceBonus) * 100) / 100;
}
