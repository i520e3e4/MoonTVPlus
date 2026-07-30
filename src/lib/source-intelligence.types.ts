import type { ApiSite } from './config';

export interface SourceHealth {
  sourceKey: string;
  searchSuccessCount: number;
  searchFailureCount: number;
  playbackSuccessCount: number;
  playbackFailureCount: number;
  timeoutCount: number;
  consecutiveFailures: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageStartupMs: number;
  bufferingCount: number;
  adSegments: number;
  healthScore: number;
  circuitOpenUntil: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  updatedAt: number;
}

export interface UserSourcePreference {
  sourceKey: string;
  preferenceScore: number;
  successfulPlays: number;
  manualSelections: number;
  lastUsedAt: number | null;
}

export interface RankedSource {
  site: ApiSite;
  score: number;
  reasons: string[];
  circuitOpen: boolean;
  exploration: boolean;
}

export interface PlaybackTelemetryInput {
  sessionId: string;
  sourceKey: string;
  deviceType: 'web' | 'tv' | 'orion' | 'tvbox' | 'unknown';
  success: boolean;
  startupMs?: number;
  bufferingCount?: number;
  playedSeconds?: number;
  completed?: boolean;
  manualSelection?: boolean;
  adSegments?: number;
  failureReason?: string;
}

export interface ProgressiveSearchOptions {
  maxCandidates?: number;
  batchSize?: number;
  enoughResults?: number;
  batchTimeoutMs?: number;
}
