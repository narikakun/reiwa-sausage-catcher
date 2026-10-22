-- Ranking tables for 令和版ソーセージキャッチャー. Run once in the rental
-- server's database (phpMyAdmin → SQL). Safe to re-run.

-- One row per started game. The token proves the score came from a real
-- play and lets the server check the play lasted long enough.
CREATE TABLE IF NOT EXISTS sausage_plays (
  token CHAR(32) NOT NULL PRIMARY KEY,
  ip_hash CHAR(64) NOT NULL,
  started_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per player. player_hash is the SHA-256 of the random key kept in
-- the player's browser, so the same browser updates its own entry.
CREATE TABLE IF NOT EXISTS sausage_players (
  player_hash CHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(10) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each player's best per ranking: period is 'all' or a Japan-time date
-- (YYYY-MM-DD) for the daily ranking.
CREATE TABLE IF NOT EXISTS sausage_bests (
  player_hash CHAR(64) NOT NULL,
  period VARCHAR(10) NOT NULL,
  score INT UNSIGNED NOT NULL,
  sausages INT UNSIGNED NOT NULL,
  achieved_at DATETIME NOT NULL,
  PRIMARY KEY (player_hash, period),
  KEY idx_ranking (period, score, achieved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every recorded game, kept as a log for checking abuse.
CREATE TABLE IF NOT EXISTS sausage_scores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_hash CHAR(64) NOT NULL,
  score INT UNSIGNED NOT NULL,
  sausages INT UNSIGNED NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_player (player_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sausage_rate_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip_hash CHAR(64) NOT NULL,
  action VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_lookup (ip_hash, action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrading from the version where every game was its own ranking entry
-- (sausage_scores had name / edit_key_hash columns). Run once before the
-- statements above; it discards the old per-game records:
-- DROP TABLE IF EXISTS sausage_scores;
