/* eslint-disable no-console */

import type {
  D1Database,
  D1DatabaseSession,
  D1PreparedStatement,
} from './d1-adapter';
import {
  getRuntimeCacheJson,
  setRuntimeCacheJson,
} from './runtime-cache';
import {
  PlaybackTelemetryInput,
  SourceHealth,
  UserSourcePreference,
} from './source-intelligence.types';

export interface SearchObservation {
  sourceKey: string;
  success: boolean;
  timeout: boolean;
  latencyMs: number;
  resultCount: number;
}

interface SourceHealthRow {
  source_key: string;
  search_success_count: number;
  search_failure_count: number;
  playback_success_count: number;
  playback_failure_count: number;
  timeout_count: number;
  consecutive_failures: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  startup_total_ms: number;
  startup_samples: number;
  buffering_count: number;
  ad_segments: number;
  health_score: number;
  circuit_open_until: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  updated_at: number;
}

interface PreferenceRow {
  source_key: string;
  preference_score: number;
  successful_plays: number;
  manual_selections: number;
  last_used_at: number | null;
}

let databasePromise: Promise<
  D1Database | D1DatabaseSession | null
> | null = null;

async function resolveDatabase(): Promise<
  D1Database | D1DatabaseSession | null
> {
  if (databasePromise) return databasePromise;

  databasePromise = (async () => {
    if (
      process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'd1' ||
      typeof window !== 'undefined'
    ) {
      return null;
    }

    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const context = await getCloudflareContext({ async: true });
      const database = ((context.env as Record<string, unknown>).DB as
        | D1Database
        | undefined) || null;
      return database?.withSession?.('first-unconstrained') || database;
    } catch (error) {
      console.warn('[SourceHealth] D1 binding unavailable:', error);
      return null;
    }
  })();

  return databasePromise;
}

function mapHealth(row: SourceHealthRow): SourceHealth {
  return {
    sourceKey: row.source_key,
    searchSuccessCount: row.search_success_count,
    searchFailureCount: row.search_failure_count,
    playbackSuccessCount: row.playback_success_count,
    playbackFailureCount: row.playback_failure_count,
    timeoutCount: row.timeout_count,
    consecutiveFailures: row.consecutive_failures,
    p50LatencyMs: row.p50_latency_ms,
    p95LatencyMs: row.p95_latency_ms,
    averageStartupMs:
      row.startup_samples > 0
        ? Math.round(row.startup_total_ms / row.startup_samples)
        : 0,
    bufferingCount: row.buffering_count,
    adSegments: row.ad_segments,
    healthScore: row.health_score,
    circuitOpenUntil: row.circuit_open_until,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    updatedAt: row.updated_at,
  };
}

export async function getSourceHealthMap(
  sourceKeys?: string[]
): Promise<Map<string, SourceHealth>> {
  const cached = await getRuntimeCacheJson<SourceHealth[]>(
    'source-health-snapshot:v1'
  );
  if (cached) {
    const requested = sourceKeys ? new Set(sourceKeys) : null;
    return new Map(
      cached
        .filter((health) => !requested || requested.has(health.sourceKey))
        .map((health) => [health.sourceKey, health])
    );
  }

  const database = await resolveDatabase();
  if (!database) return new Map();

  try {
    let result;
    if (sourceKeys && sourceKeys.length > 0) {
      const placeholders = sourceKeys.map(() => '?').join(',');
      result = await database
        .prepare(
          `SELECT * FROM source_health WHERE source_key IN (${placeholders})`
        )
        .bind(...sourceKeys)
        .all<SourceHealthRow>();
    } else {
      result = await database
        .prepare('SELECT * FROM source_health ORDER BY health_score DESC')
        .all<SourceHealthRow>();
    }

    const health = (result.results || []).map(mapHealth);
    await setRuntimeCacheJson('source-health-snapshot:v1', health, 60);
    return new Map(health.map((item) => [item.sourceKey, item]));
  } catch (error) {
    console.warn('[SourceHealth] Failed to read health data:', error);
    return new Map();
  }
}

export async function getUserSourcePreferenceMap(
  username: string
): Promise<Map<string, UserSourcePreference>> {
  const cacheKey = `source-preferences:v1:${encodeURIComponent(username)}`;
  const cached = await getRuntimeCacheJson<UserSourcePreference[]>(cacheKey);
  if (cached) {
    return new Map(cached.map((item) => [item.sourceKey, item]));
  }

  const database = await resolveDatabase();
  if (!database) return new Map();

  try {
    const result = await database
      .prepare(
        `SELECT source_key, preference_score, successful_plays,
                manual_selections, last_used_at
           FROM user_source_preferences
          WHERE username = ?
          ORDER BY preference_score DESC
          LIMIT 100`
      )
      .bind(username)
      .all<PreferenceRow>();

    const preferences = (result.results || []).map((row) => ({
      sourceKey: row.source_key,
      preferenceScore: row.preference_score,
      successfulPlays: row.successful_plays,
      manualSelections: row.manual_selections,
      lastUsedAt: row.last_used_at,
    }));
    await setRuntimeCacheJson(cacheKey, preferences, 60);
    return new Map(preferences.map((item) => [item.sourceKey, item]));
  } catch (error) {
    console.warn('[SourceHealth] Failed to read user preferences:', error);
    return new Map();
  }
}

export async function recordSearchObservations(
  observations: SearchObservation[]
): Promise<void> {
  if (observations.length === 0) return;
  const database = await resolveDatabase();
  if (!database) return;

  const now = Date.now();
  const statDate = new Date(now).toISOString().slice(0, 10);
  const statements: D1PreparedStatement[] = [];

  for (const observation of observations) {
    const success = observation.success ? 1 : 0;
    const failure = observation.success ? 0 : 1;
    const timeout = observation.timeout ? 1 : 0;
    const latency = Math.max(0, Math.round(observation.latencyMs));
    const healthDelta = success ? (observation.resultCount > 0 ? 2 : 0.5) : -4;
    const timeoutDelta = timeout ? -2 : 0;

    statements.push(
      database
        .prepare(
          `INSERT INTO source_health (
             source_key, search_success_count, search_failure_count,
             timeout_count, consecutive_failures, latency_total_ms,
             latency_samples, p50_latency_ms, p95_latency_ms, health_score,
             circuit_open_until, last_success_at, last_failure_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_key) DO UPDATE SET
             search_success_count = search_success_count + excluded.search_success_count,
             search_failure_count = search_failure_count + excluded.search_failure_count,
             timeout_count = timeout_count + excluded.timeout_count,
             consecutive_failures = CASE
               WHEN excluded.search_success_count = 1 THEN 0
               ELSE consecutive_failures + 1
             END,
             latency_total_ms = latency_total_ms + excluded.latency_total_ms,
             latency_samples = latency_samples + 1,
             p50_latency_ms = CAST((p50_latency_ms * 4 + excluded.p50_latency_ms) / 5 AS INTEGER),
             p95_latency_ms = MAX(
               excluded.p95_latency_ms,
               CAST((p95_latency_ms * 9 + excluded.p95_latency_ms) / 10 AS INTEGER)
             ),
             health_score = MIN(100, MAX(0, health_score + ?)),
             circuit_open_until = CASE
               WHEN excluded.search_success_count = 1 THEN NULL
               WHEN consecutive_failures + 1 >= 3 THEN
                 excluded.updated_at + MIN(1800000, 300000 * (consecutive_failures - 1))
               ELSE circuit_open_until
             END,
             last_success_at = CASE
               WHEN excluded.search_success_count = 1 THEN excluded.updated_at
               ELSE last_success_at
             END,
             last_failure_at = CASE
               WHEN excluded.search_failure_count = 1 THEN excluded.updated_at
               ELSE last_failure_at
             END,
             updated_at = excluded.updated_at`
        )
        .bind(
          observation.sourceKey,
          success,
          failure,
          timeout,
          failure,
          latency,
          latency,
          latency,
          Math.max(0, Math.min(100, 60 + healthDelta + timeoutDelta)),
          failure >= 3 ? now + 300000 : null,
          success ? now : null,
          failure ? now : null,
          now,
          healthDelta + timeoutDelta
        )
    );

    statements.push(
      database
        .prepare(
          `INSERT INTO source_daily_stats (
             stat_date, source_key, searches, successful_searches
           ) VALUES (?, ?, 1, ?)
           ON CONFLICT(stat_date, source_key) DO UPDATE SET
             searches = searches + 1,
             successful_searches = successful_searches + excluded.successful_searches`
        )
        .bind(statDate, observation.sourceKey, observation.resultCount > 0 ? 1 : 0)
    );
  }

  try {
    await database.batch(statements);
  } catch (error) {
    console.warn('[SourceHealth] Failed to store search observations:', error);
  }
}

export async function recordPlaybackTelemetry(params: {
  username: string;
  telemetry: PlaybackTelemetryInput;
}): Promise<void> {
  const database = await resolveDatabase();
  if (!database) return;

  const { username, telemetry } = params;
  const now = Date.now();
  const statDate = new Date(now).toISOString().slice(0, 10);
  const success = telemetry.success ? 1 : 0;
  const startupMs = Math.max(0, Math.min(120000, telemetry.startupMs || 0));
  const bufferingCount = Math.max(
    0,
    Math.min(1000, telemetry.bufferingCount || 0)
  );
  const adSegments = Math.max(0, Math.min(1000, telemetry.adSegments || 0));
  const preferenceDelta =
    (success ? 2 : -2) + (telemetry.manualSelection ? 1.5 : 0);
  const healthDelta = success ? 1.5 : -3;

  const statements = [
    database
      .prepare(
        `INSERT OR REPLACE INTO playback_sessions (
           id, username, source_key, device_type, success, startup_ms,
           buffering_count, played_seconds, completed, manual_selection,
           ad_segments, failure_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        telemetry.sessionId,
        username,
        telemetry.sourceKey,
        telemetry.deviceType,
        success,
        startupMs,
        bufferingCount,
        Math.max(0, Math.min(86400, telemetry.playedSeconds || 0)),
        telemetry.completed ? 1 : 0,
        telemetry.manualSelection ? 1 : 0,
        adSegments,
        telemetry.failureReason?.slice(0, 120) || null,
        now
      ),
    database
      .prepare(
        `INSERT INTO source_health (
           source_key, playback_success_count, playback_failure_count,
           consecutive_failures, startup_total_ms, startup_samples,
           buffering_count, ad_segments, health_score, circuit_open_until,
           last_success_at, last_failure_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_key) DO UPDATE SET
           playback_success_count = playback_success_count + excluded.playback_success_count,
           playback_failure_count = playback_failure_count + excluded.playback_failure_count,
           consecutive_failures = CASE
             WHEN excluded.playback_success_count = 1 THEN 0
             ELSE consecutive_failures + 1
           END,
           startup_total_ms = startup_total_ms + excluded.startup_total_ms,
           startup_samples = startup_samples + 1,
           buffering_count = buffering_count + excluded.buffering_count,
           ad_segments = ad_segments + excluded.ad_segments,
           health_score = MIN(100, MAX(0, health_score + ?)),
           circuit_open_until = CASE
             WHEN excluded.playback_success_count = 1 THEN NULL
             WHEN consecutive_failures + 1 >= 3 THEN
               excluded.updated_at + MIN(1800000, 300000 * (consecutive_failures - 1))
             ELSE circuit_open_until
           END,
           last_success_at = CASE
             WHEN excluded.playback_success_count = 1 THEN excluded.updated_at
             ELSE last_success_at
           END,
           last_failure_at = CASE
             WHEN excluded.playback_failure_count = 1 THEN excluded.updated_at
             ELSE last_failure_at
           END,
           updated_at = excluded.updated_at`
      )
      .bind(
        telemetry.sourceKey,
        success,
        success ? 0 : 1,
        success ? 0 : 1,
        startupMs,
        bufferingCount,
        adSegments,
        Math.max(0, Math.min(100, 60 + healthDelta)),
        success ? null : now + 300000,
        success ? now : null,
        success ? null : now,
        now,
        healthDelta
      ),
    database
      .prepare(
        `INSERT INTO user_source_preferences (
           username, source_key, preference_score, successful_plays,
           manual_selections, last_used_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username, source_key) DO UPDATE SET
           preference_score = MIN(15, MAX(-15, preference_score + ?)),
           successful_plays = successful_plays + excluded.successful_plays,
           manual_selections = manual_selections + excluded.manual_selections,
           last_used_at = excluded.last_used_at,
           updated_at = excluded.updated_at`
      )
      .bind(
        username,
        telemetry.sourceKey,
        preferenceDelta,
        success,
        telemetry.manualSelection ? 1 : 0,
        now,
        now,
        preferenceDelta
      ),
    database
      .prepare(
        `INSERT INTO source_daily_stats (
           stat_date, source_key, playback_attempts, playback_successes,
           startup_total_ms, buffering_count, ad_segments
         ) VALUES (?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(stat_date, source_key) DO UPDATE SET
           playback_attempts = playback_attempts + 1,
           playback_successes = playback_successes + excluded.playback_successes,
           startup_total_ms = startup_total_ms + excluded.startup_total_ms,
           buffering_count = buffering_count + excluded.buffering_count,
           ad_segments = ad_segments + excluded.ad_segments`
      )
      .bind(
        statDate,
        telemetry.sourceKey,
        success,
        startupMs,
        bufferingCount,
        adSegments
      ),
    database
      .prepare('DELETE FROM playback_sessions WHERE created_at < ?')
      .bind(now - 7 * 24 * 60 * 60 * 1000),
  ];

  await database.batch(statements);
}

export async function getSourceOverview(): Promise<{
  totalSources: number;
  healthySources: number;
  degradedSources: number;
  circuitOpenSources: number;
  searchSuccessRate: number;
  playbackSuccessRate: number;
  averageStartupMs: number;
}> {
  const database = await resolveDatabase();
  if (!database) {
    return {
      totalSources: 0,
      healthySources: 0,
      degradedSources: 0,
      circuitOpenSources: 0,
      searchSuccessRate: 0,
      playbackSuccessRate: 0,
      averageStartupMs: 0,
    };
  }

  const now = Date.now();
  const row = await database
    .prepare(
      `SELECT
         COUNT(*) AS total_sources,
         SUM(CASE WHEN health_score >= 70 THEN 1 ELSE 0 END) AS healthy_sources,
         SUM(CASE WHEN health_score < 50 THEN 1 ELSE 0 END) AS degraded_sources,
         SUM(CASE WHEN circuit_open_until > ? THEN 1 ELSE 0 END) AS circuit_open_sources,
         SUM(search_success_count) AS search_success,
         SUM(search_success_count + search_failure_count) AS search_total,
         SUM(playback_success_count) AS playback_success,
         SUM(playback_success_count + playback_failure_count) AS playback_total,
         SUM(startup_total_ms) AS startup_total,
         SUM(startup_samples) AS startup_samples
       FROM source_health`
    )
    .bind(now)
    .first<Record<string, number>>();

  const safe = row || {};
  return {
    totalSources: safe.total_sources || 0,
    healthySources: safe.healthy_sources || 0,
    degradedSources: safe.degraded_sources || 0,
    circuitOpenSources: safe.circuit_open_sources || 0,
    searchSuccessRate:
      safe.search_total > 0 ? safe.search_success / safe.search_total : 0,
    playbackSuccessRate:
      safe.playback_total > 0
        ? safe.playback_success / safe.playback_total
        : 0,
    averageStartupMs:
      safe.startup_samples > 0
        ? Math.round(safe.startup_total / safe.startup_samples)
        : 0,
  };
}

export interface ConfigVersion {
  id: string;
  config: string;
  changedBy: string;
  changeSummary: string;
  createdAt: number;
}

export async function recordConfigVersion(params: {
  config: unknown;
  changedBy: string;
  changeSummary: string;
}): Promise<string | null> {
  const database = await resolveDatabase();
  if (!database) return null;
  const id = crypto.randomUUID();
  await database
    .prepare(
      `INSERT INTO config_versions
       (id, config, changed_by, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      JSON.stringify(params.config),
      params.changedBy,
      params.changeSummary,
      Date.now()
    )
    .run();
  return id;
}

export async function listConfigVersions(limit = 20): Promise<ConfigVersion[]> {
  const database = await resolveDatabase();
  if (!database) return [];
  const result = await database
    .prepare(
      `SELECT id, config, changed_by, change_summary, created_at
       FROM config_versions ORDER BY created_at DESC LIMIT ?`
    )
    .bind(Math.min(100, Math.max(1, limit)))
    .all<{
      id: string;
      config: string;
      changed_by: string;
      change_summary: string;
      created_at: number;
    }>();
  return (result.results || []).map((row) => ({
    id: row.id,
    config: row.config,
    changedBy: row.changed_by,
    changeSummary: row.change_summary || '',
    createdAt: row.created_at,
  }));
}

export async function getConfigVersion(
  id: string
): Promise<ConfigVersion | null> {
  const database = await resolveDatabase();
  if (!database) return null;
  const row = await database
    .prepare(
      `SELECT id, config, changed_by, change_summary, created_at
       FROM config_versions WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: string;
      config: string;
      changed_by: string;
      change_summary: string;
      created_at: number;
    }>();
  return row
    ? {
        id: row.id,
        config: row.config,
        changedBy: row.changed_by,
        changeSummary: row.change_summary || '',
        createdAt: row.created_at,
      }
    : null;
}
