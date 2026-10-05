CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 20),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  kills INTEGER NOT NULL DEFAULT 0 CHECK(kills >= 0),
  deaths INTEGER NOT NULL DEFAULT 0 CHECK(deaths >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS players_leaderboard
  ON players (wins DESC, kills DESC, deaths ASC, updated_at DESC);
