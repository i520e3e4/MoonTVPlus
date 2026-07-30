import type { ApiSite } from './config';
import {
  ProgressiveSearchOptions,
  RankedSource,
  SourceHealth,
  UserSourcePreference,
} from './source-intelligence.types';

const DEFAULT_HEALTH_SCORE = 60;
const MAX_PREFERENCE_BONUS = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function calculateHealthScore(
  health: Partial<SourceHealth>,
  now = Date.now()
): number {
  const searchSuccess = health.searchSuccessCount || 0;
  const searchFailure = health.searchFailureCount || 0;
  const playbackSuccess = health.playbackSuccessCount || 0;
  const playbackFailure = health.playbackFailureCount || 0;
  const searchTotal = searchSuccess + searchFailure;
  const playbackTotal = playbackSuccess + playbackFailure;
  const searchRate = searchTotal > 0 ? searchSuccess / searchTotal : 0.6;
  const playbackRate =
    playbackTotal > 0 ? playbackSuccess / playbackTotal : 0.7;
  const p50 = health.p50LatencyMs || 1500;
  const p95 = health.p95LatencyMs || 4000;
  const latencyScore =
    1 - clamp((p50 * 0.6 + p95 * 0.4 - 500) / 7500, 0, 1);
  const timeoutPenalty = clamp((health.timeoutCount || 0) / 20, 0, 1);
  const bufferingPenalty = clamp((health.bufferingCount || 0) / 30, 0, 1);
  const adPenalty = clamp((health.adSegments || 0) / 50, 0, 1);
  const circuitPenalty =
    health.circuitOpenUntil && health.circuitOpenUntil > now ? 1 : 0;

  return Math.round(
    clamp(
      (searchRate * 0.3 +
        playbackRate * 0.3 +
        latencyScore * 0.2 +
        (1 - timeoutPenalty) * 0.08 +
        (1 - bufferingPenalty) * 0.07 +
        (1 - adPenalty) * 0.05) *
        100 -
        circuitPenalty * 50,
      0,
      100
    ) *
      100
  ) / 100;
}

export function rankSources(params: {
  sites: ApiSite[];
  healthByKey?: Map<string, SourceHealth>;
  preferenceByKey?: Map<string, UserSourcePreference>;
  configuredWeightByKey?: Map<string, number>;
  query?: string;
  now?: number;
  maxCandidates?: number;
}): RankedSource[] {
  const {
    sites,
    healthByKey = new Map(),
    preferenceByKey = new Map(),
    configuredWeightByKey = new Map(),
    query = '',
    now = Date.now(),
    maxCandidates = 12,
  } = params;

  const ranked = sites.map<RankedSource>((site) => {
    const health = healthByKey.get(site.key);
    const preference = preferenceByKey.get(site.key);
    const circuitOpen = Boolean(
      health?.circuitOpenUntil && health.circuitOpenUntil > now
    );
    const healthScore = health?.healthScore ?? DEFAULT_HEALTH_SCORE;
    const preferenceBonus = clamp(
      preference?.preferenceScore || 0,
      -MAX_PREFERENCE_BONUS,
      MAX_PREFERENCE_BONUS
    );
    const configuredBonus = clamp(
      configuredWeightByKey.get(site.key) || 0,
      -20,
      20
    );
    const recencyRecovery =
      health?.lastSuccessAt && now - health.lastSuccessAt < 24 * 60 * 60 * 1000
        ? 2
        : 0;
    const score =
      healthScore + preferenceBonus + configuredBonus + recencyRecovery;

    const reasons = [
      `health:${healthScore.toFixed(1)}`,
      `preference:${preferenceBonus.toFixed(1)}`,
      `configured:${configuredBonus.toFixed(1)}`,
    ];
    if (circuitOpen) reasons.push('circuit-open');

    return {
      site,
      score: circuitOpen ? score - 100 : score,
      reasons,
      circuitOpen,
      exploration: false,
    };
  });

  const available = ranked
    .filter((source) => !source.circuitOpen)
    .sort((a, b) => b.score - a.score || a.site.key.localeCompare(b.site.key));
  const circuitOpen = ranked
    .filter((source) => source.circuitOpen)
    .sort((a, b) => b.score - a.score);

  const targetCount = Math.min(maxCandidates, sites.length);
  const exploitationCount =
    targetCount >= 6 ? Math.max(1, targetCount - 1) : targetCount;
  const selected = available.slice(0, exploitationCount);
  const explorationPool = available.slice(exploitationCount);

  if (selected.length < targetCount && explorationPool.length > 0) {
    const explorationIndex =
      stableHash(`${query}:${now.toString().slice(0, -6)}`) %
      explorationPool.length;
    selected.push({
      ...explorationPool[explorationIndex],
      exploration: true,
      reasons: [...explorationPool[explorationIndex].reasons, 'exploration'],
    });
  }

  if (selected.length < targetCount) {
    selected.push(...circuitOpen.slice(0, targetCount - selected.length));
  }

  return selected.slice(0, targetCount);
}

export async function progressiveSearch<T>(params: {
  sources: RankedSource[];
  search: (source: RankedSource, signal: AbortSignal) => Promise<T[]>;
  onObservation?: (
    source: RankedSource,
    observation: {
      success: boolean;
      timeout: boolean;
      latencyMs: number;
      resultCount: number;
    }
  ) => Promise<void> | void;
  options?: ProgressiveSearchOptions;
}): Promise<{ results: T[]; attempted: RankedSource[] }> {
  const {
    sources,
    search,
    onObservation,
    options: {
      maxCandidates = 12,
      batchSize = 4,
      enoughResults = 12,
      batchTimeoutMs = 8500,
    } = {},
  } = params;

  const candidates = sources.slice(0, maxCandidates);
  const results: T[] = [];
  const attempted: RankedSource[] = [];

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    attempted.push(...batch);
    const batchResults = await Promise.all(
      batch.map(async (source) => {
        const controller = new AbortController();
        const startedAt = Date.now();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, batchTimeoutMs);

        try {
          const sourceResults = await search(source, controller.signal);
          await onObservation?.(source, {
            success: true,
            timeout: false,
            latencyMs: Date.now() - startedAt,
            resultCount: sourceResults.length,
          });
          return sourceResults;
        } catch {
          await onObservation?.(source, {
            success: false,
            timeout: timedOut,
            latencyMs: Date.now() - startedAt,
            resultCount: 0,
          });
          return [];
        } finally {
          clearTimeout(timeoutId);
        }
      })
    );

    results.push(...batchResults.flat());
    if (results.length >= enoughResults) break;
  }

  return { results, attempted };
}
