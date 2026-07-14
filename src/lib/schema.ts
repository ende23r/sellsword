export const DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS hexes (
    id      INTEGER PRIMARY KEY,
    q       INTEGER NOT NULL,
    r       INTEGER NOT NULL,
    terrain TEXT    NOT NULL,
    settlement INTEGER NOT NULL DEFAULT 0,
    roads   TEXT NOT NULL DEFAULT '[]',
    rivers  TEXT NOT NULL DEFAULT '[]',
    forage_count  INTEGER NOT NULL DEFAULT 0,
    last_foraged  TEXT,
    UNIQUE(q, r)
  );

  CREATE TABLE IF NOT EXISTS strongholds (
    id             INTEGER PRIMARY KEY,
    hex_id         INTEGER NOT NULL REFERENCES hexes(id),
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('fortress', 'town', 'city')),
    garrison       INTEGER NOT NULL DEFAULT 0,
    threshold      INTEGER NOT NULL,
    controlled_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS factions (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    discord_role_id     TEXT NOT NULL UNIQUE,
    discord_category_id TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS commanders (
    id                  INTEGER PRIMARY KEY,
    discord_user_id     TEXT NOT NULL UNIQUE,
    discord_channel_id  TEXT,
    faction_id          INTEGER REFERENCES factions(id),
    army_sheet_url      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS armies (
    id              INTEGER PRIMARY KEY,
    commander_id    INTEGER NOT NULL UNIQUE REFERENCES commanders(id),
    name            TEXT,
    hex_q           INTEGER NOT NULL DEFAULT 0,
    hex_r           INTEGER NOT NULL DEFAULT 0,
    infantry        INTEGER NOT NULL DEFAULT 0,
    cavalry         INTEGER NOT NULL DEFAULT 0,
    wagons          INTEGER NOT NULL DEFAULT 0,
    noncombatants   INTEGER NOT NULL DEFAULT 0,
    morale          INTEGER NOT NULL DEFAULT 9,
    resting_morale  INTEGER NOT NULL DEFAULT 9,
    max_morale      INTEGER NOT NULL DEFAULT 12,
    supplies        INTEGER NOT NULL DEFAULT 0,
    coin            INTEGER NOT NULL DEFAULT 0,
    goods           INTEGER NOT NULL DEFAULT 0,
    forced_march    INTEGER NOT NULL DEFAULT 0,
    night_march     INTEGER NOT NULL DEFAULT 0,
    stance          TEXT    NOT NULL DEFAULT 'allow' CHECK(stance IN ('allow', 'block'))
  );

  CREATE TABLE IF NOT EXISTS detachments (
    id       INTEGER PRIMARY KEY,
    army_id  INTEGER NOT NULL REFERENCES armies(id),
    name     TEXT,
    type     TEXT NOT NULL CHECK(type IN ('infantry', 'heavy_infantry', 'cavalry', 'heavy_cavalry', 'skirmisher')),
    size     INTEGER NOT NULL,
    wagons   INTEGER NOT NULL DEFAULT 0,
    honors   TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY,
    army_id      INTEGER NOT NULL REFERENCES armies(id),
    type         TEXT NOT NULL CHECK(type IN ('forage', 'move', 'rest', 'torch')),
    parameters   TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                     INTEGER PRIMARY KEY,
    sender_commander_id    INTEGER NOT NULL REFERENCES commanders(id),
    recipient_commander_id INTEGER NOT NULL REFERENCES commanders(id),
    content                TEXT NOT NULL,
    sent_at                TEXT NOT NULL DEFAULT (datetime('now')),
    delivers_at            TEXT NOT NULL,
    delivered              INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS queue (
    id               INTEGER PRIMARY KEY,
    discord_user_id  TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    added_at         TEXT NOT NULL DEFAULT (datetime('now')),
    added_by_id      TEXT NOT NULL
  );
`;
