-- Voice Calendar Integrator — SQLite schema (development)
-- Use a managed Postgres instance in production.

CREATE TABLE IF NOT EXISTS tokens (
  userId      TEXT PRIMARY KEY,
  tokens_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id               TEXT PRIMARY KEY,
  userId           TEXT NOT NULL,
  raw_text         TEXT,
  parsed_json      TEXT,
  calendar_event_id TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       INTEGER NOT NULL
);
