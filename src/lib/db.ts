import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../../sellsword.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    id                  INTEGER PRIMARY KEY,
    sender_commander_id INTEGER NOT NULL REFERENCES commanders(id),
    recipient_commander_id INTEGER NOT NULL REFERENCES commanders(id),
    content             TEXT NOT NULL,
    sent_at             TEXT NOT NULL DEFAULT (datetime('now')),
    delivers_at         TEXT NOT NULL,
    delivered           INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS queue (
    id               INTEGER PRIMARY KEY,
    discord_user_id  TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    added_at         TEXT NOT NULL DEFAULT (datetime('now')),
    added_by_id      TEXT NOT NULL
  );
`);

export type HexRow = {
  id: number;
  q: number;
  r: number;
  terrain: string;
  settlement: number;
  roads: string;
  rivers: string;
  forage_count: number;
  last_foraged: string | null;
};

export type StrongholdRow = {
  id: number;
  hex_id: number;
  name: string;
  type: 'fortress' | 'town' | 'city';
  garrison: number;
  threshold: number;
  controlled_by: string | null;
};

export type CommanderRow = {
  id: number;
  discord_user_id: string;
  discord_channel_id: string | null;
  faction_id: number | null;
  army_sheet_url: string | null;
  created_at: string;
};

export type ArmyRow = {
  id: number;
  commander_id: number;
  name: string | null;
  hex_q: number;
  hex_r: number;
  infantry: number;
  cavalry: number;
  wagons: number;
  noncombatants: number;
  morale: number;
  resting_morale: number;
  max_morale: number;
  supplies: number;
  coin: number;
  goods: number;
  forced_march: number;
  night_march: number;
  stance: 'allow' | 'block';
};

export type FactionRow = {
  id: number;
  name: string;
  discord_role_id: string;
  discord_category_id: string;
};

export type OrderRow = {
  id: number;
  army_id: number;
  type: 'forage' | 'move' | 'rest' | 'torch';
  parameters: string;
  created_at: string;
  processed_at: string | null;
};

export type QueueRow = {
  id: number;
  discord_user_id: string;
  discord_username: string;
  added_at: string;
  added_by_id: string;
};

// Query helpers

export function getCommanderByDiscordId(discordUserId: string): CommanderRow | undefined {
  return db.prepare('SELECT * FROM commanders WHERE discord_user_id = ?').get(discordUserId) as
    CommanderRow | undefined;
}

export function getArmyByCommanderId(commanderId: number): ArmyRow | undefined {
  return db.prepare('SELECT * FROM armies WHERE commander_id = ?').get(commanderId) as
    ArmyRow | undefined;
}

export function getArmyByDiscordId(discordUserId: string): ArmyRow | undefined {
  const commander = getCommanderByDiscordId(discordUserId);
  if (!commander) return undefined;
  return getArmyByCommanderId(commander.id);
}

export function getHex(q: number, r: number): HexRow | undefined {
  return db.prepare('SELECT * FROM hexes WHERE q = ? AND r = ?').get(q, r) as HexRow | undefined;
}

export function getAllHexes(): HexRow[] {
  return db.prepare('SELECT * FROM hexes').all() as HexRow[];
}

export function getAllStrongholds(): StrongholdRow[] {
  return db.prepare('SELECT * FROM strongholds').all() as StrongholdRow[];
}

export function getAllArmies(): ArmyRow[] {
  return db.prepare('SELECT * FROM armies').all() as ArmyRow[];
}

export function getPendingOrders(type?: string): OrderRow[] {
  if (type) {
    return db
      .prepare('SELECT * FROM orders WHERE processed_at IS NULL AND type = ?')
      .all(type) as OrderRow[];
  }
  return db.prepare('SELECT * FROM orders WHERE processed_at IS NULL').all() as OrderRow[];
}

export function markOrderProcessed(orderId: number): void {
  db.prepare("UPDATE orders SET processed_at = datetime('now') WHERE id = ?").run(orderId);
}

export function getDailySuppplyConsumption(army: ArmyRow): number {
  return army.infantry + army.noncombatants + (army.cavalry + army.wagons) * 10;
}

export default db;
