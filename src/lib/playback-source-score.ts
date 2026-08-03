export interface PlaybackProbeResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate?: string;
  throughputKbps?: number;
  sustainabilityRatio?: number;
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
  contentMatchScore?: number;
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

export function calculateAbsoluteSpeedScore(speedKBps: number | null): number {
  if (speedKBps === null || speedKBps <= 0) return 0;
  if (speedKBps >= 4096) return 100;
  if (speedKBps >= 2048) return 85 + ((speedKBps - 2048) / 2048) * 15;
  if (speedKBps >= 1024) return 70 + ((speedKBps - 1024) / 1024) * 15;
  if (speedKBps >= 512) return 50 + ((speedKBps - 512) / 512) * 20;
  if (speedKBps >= 128) return 15 + ((speedKBps - 128) / 384) * 35;
  return (speedKBps / 128) * 15;
}

export function calculateSustainabilityScore(ratio?: number): number {
  if (!ratio || ratio <= 0) return 25;
  if (ratio < 0.8) return (ratio / 0.8) * 10;
  if (ratio < 1) return 10 + ((ratio - 0.8) / 0.2) * 15;
  if (ratio < 1.5) return 25 + ((ratio - 1) / 0.5) * 35;
  if (ratio < 2) return 60 + ((ratio - 1.5) / 0.5) * 20;
  if (ratio < 3) return 80 + (ratio - 2) * 20;
  return 100;
}

export function calculateAbsolutePingScore(pingMs: number): number {
  if (!Number.isFinite(pingMs) || pingMs <= 0) return 20;
  if (pingMs <= 100) return 100;
  if (pingMs <= 300) return 100 - ((pingMs - 100) / 200) * 20;
  if (pingMs <= 800) return 80 - ((pingMs - 300) / 500) * 30;
  if (pingMs <= 1500) return 50 - ((pingMs - 800) / 700) * 30;
  if (pingMs <= 2500) return 20 - ((pingMs - 1500) / 1000) * 20;
  return 0;
}

export function calculatePlaybackSourceScore({
  testResult,
  maxSpeedKBps,
  maxBitrateKbps = 0,
  episodeCount,
  maxEpisodeCount,
  historicalHealthScore = 55,
  preferenceScore = 0,
  contentMatchScore = 100,
  configuredWeight = 0,
}: PlaybackSourceScoreInput): number {
  // Unknown metadata is neutral rather than fatal: some otherwise healthy
  // signed/native streams cannot expose resolution before playback starts.
  const qualityScore = QUALITY_SCORES[testResult.quality] ?? 45;

  const speedKBps = parseLoadSpeedKBps(testResult.loadSpeed);
  const relativeSpeedScore =
    speedKBps === null || maxSpeedKBps <= 0
      ? 30
      : Math.min(100, Math.max(0, (speedKBps / maxSpeedKBps) * 100));
  // Absolute thresholds prevent a group of uniformly slow sources from
  // awarding 100 points to the least-bad one. Keep a small relative component
  // to break ties among sources measured on the same client/network.
  const speedScore =
    calculateAbsoluteSpeedScore(speedKBps) * 0.8 + relativeSpeedScore * 0.2;
  const pingScore = calculateAbsolutePingScore(testResult.pingTime);
  const sustainabilityScore = calculateSustainabilityScore(
    testResult.sustainabilityRatio
  );

  const bitrateKbps = parseBitrateKbps(testResult.bitrate);
  const bitrateScore =
    bitrateKbps === null || maxBitrateKbps <= 0
      ? 45
      : Math.min(100, Math.max(0, (bitrateKbps / maxBitrateKbps) * 100));
  const reliabilityScore = Math.min(100, Math.max(0, historicalHealthScore));
  const matchScore = Math.min(100, Math.max(0, contentMatchScore));

  const isSeries = maxEpisodeCount > 1;
  const episodeCoverageScore = isSeries
    ? Math.min(100, Math.max(0, (episodeCount / maxEpisodeCount) * 100))
    : 100;

  const score = isSeries
    ? qualityScore * 0.17 +
      bitrateScore * 0.06 +
      speedScore * 0.14 +
      sustainabilityScore * 0.15 +
      pingScore * 0.07 +
      reliabilityScore * 0.15 +
      episodeCoverageScore * 0.16 +
      matchScore * 0.1
    : qualityScore * 0.2 +
      bitrateScore * 0.08 +
      speedScore * 0.17 +
      sustainabilityScore * 0.18 +
      pingScore * 0.08 +
      reliabilityScore * 0.19 +
      matchScore * 0.1;

  const configuredBonus = Math.min(10, Math.max(-10, configuredWeight));
  const preferenceBonus = Math.min(8, Math.max(-8, preferenceScore));
  return Math.round((score + configuredBonus + preferenceBonus) * 100) / 100;
}
