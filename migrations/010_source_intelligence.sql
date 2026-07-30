-- Source intelligence, playback telemetry and versioned configuration.
-- Additive-only migration so existing MoonTVPlus deployments remain compatible.

CREATE TABLE IF NOT EXISTS source_health (
  source_key TEXT PRIMARY KEY,
  search_success_count INTEGER NOT NULL DEFAULT 0,
  search_failure_count INTEGER NOT NULL DEFAULT 0,
  playback_success_count INTEGER NOT NULL DEFAULT 0,
  playback_failure_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  latency_total_ms INTEGER NOT NULL DEFAULT 0,
  latency_samples INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms INTEGER NOT NULL DEFAULT 0,
  p95_latency_ms INTEGER NOT NULL DEFAULT 0,
  startup_total_ms INTEGER NOT NULL DEFAULT 0,
  startup_samples INTEGER NOT NULL DEFAULT 0,
  buffering_count INTEGER NOT NULL DEFAULT 0,
  ad_segments INTEGER NOT NULL DEFAULT 0,
  health_score REAL NOT NULL DEFAULT 60,
  circuit_open_until INTEGER,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_health_score
  ON source_health(health_score DESC, circuit_open_until);
CREATE INDEX IF NOT EXISTS idx_source_health_updated
  ON source_health(updated_at DESC);

CREATE TABLE IF NOT EXISTS source_daily_stats (
  stat_date TEXT NOT NULL,
  source_key TEXT NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  successful_searches INTEGER NOT NULL DEFAULT 0,
  playback_attempts INTEGER NOT NULL DEFAULT 0,
  playback_successes INTEGER NOT NULL DEFAULT 0,
  startup_total_ms INTEGER NOT NULL DEFAULT 0,
  buffering_count INTEGER NOT NULL DEFAULT 0,
  ad_segments INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, source_key)
);

CREATE INDEX IF NOT EXISTS idx_source_daily_stats_source_date
  ON source_daily_stats(source_key, stat_date DESC);

CREATE TABLE IF NOT EXISTS user_source_preferences (
  username TEXT NOT NULL,
  source_key TEXT NOT NULL,
  preference_score REAL NOT NULL DEFAULT 0,
  successful_plays INTEGER NOT NULL DEFAULT 0,
  manual_selections INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, source_key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_source_preferences_rank
  ON user_source_preferences(username, preference_score DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS playback_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  source_key TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'web',
  success INTEGER NOT NULL DEFAULT 0,
  startup_ms INTEGER,
  buffering_count INTEGER NOT NULL DEFAULT 0,
  played_seconds INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  manual_selection INTEGER NOT NULL DEFAULT 0,
  ad_segments INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_created
  ON playback_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_source_created
  ON playback_sessions(source_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_created
  ON playback_sessions(username, created_at DESC);

CREATE TABLE IF NOT EXISTS config_versions (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_summary TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_versions_created
  ON config_versions(created_at DESC);

