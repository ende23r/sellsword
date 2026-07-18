import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DB_SCHEMA } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../../sellsword.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(DB_SCHEMA);

// Migration: add speed column to hexes if absent.
{
  const hexesCols = db.pragma('table_info(hexes)') as { name: string }[];
  if (!hexesCols.some((c) => c.name === 'speed')) {
    db.exec('ALTER TABLE hexes ADD COLUMN speed INTEGER NOT NULL DEFAULT 6');
  }
}

// Migration: remove stat columns from armies (now in Google Sheets).
{
  const armiesCols = db.pragma('table_info(armies)') as { name: string }[];
  const names = new Set(armiesCols.map((c) => c.name));
  const statCols = [
    'infantry', 'infantry_strength', 'cavalry', 'cavalry_strength',
    'wagons', 'noncombatants', 'scouting_range', 'morale', 'resting_morale',
    'max_morale', 'supplies', 'coin', 'goods', 'forced_march', 'night_march', 'stance',
  ];
  for (const col of statCols) {
    if (names.has(col)) db.exec(`ALTER TABLE armies DROP COLUMN ${col}`);
  }
}

// Migrations for factions table.
const factionsCols = db.pragma('table_info(factions)') as { name: string; notnull: number }[];
const factionsColNames = new Set(factionsCols.map((c) => c.name));

// Make discord_category_id nullable if it was created NOT NULL.
const categoryCol = factionsCols.find((c) => c.name === 'discord_category_id');
if (categoryCol?.notnull === 1) {
  db.exec(`
    CREATE TABLE factions_new (
      id                  INTEGER PRIMARY KEY,
      name                TEXT NOT NULL,
      color               TEXT,
      doc_url             TEXT,
      discord_role_id     TEXT NOT NULL UNIQUE,
      discord_category_id TEXT UNIQUE
    );
    INSERT OR IGNORE INTO factions_new (id, name, discord_role_id, discord_category_id)
      SELECT id, name, discord_role_id, discord_category_id FROM factions;
    DROP TABLE factions;
    ALTER TABLE factions_new RENAME TO factions;
  `);
} else {
  if (!factionsColNames.has('color')) db.exec('ALTER TABLE factions ADD COLUMN color TEXT');
  if (!factionsColNames.has('doc_url')) db.exec('ALTER TABLE factions ADD COLUMN doc_url TEXT');
}

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
  speed: number;
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
};

export type FactionRow = {
  id: number;
  name: string;
  color: string | null;
  doc_url: string | null;
  discord_role_id: string;
  discord_category_id: string | null;
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

export type ConferenceChannelRow = {
  id: number;
  hex_q: number;
  hex_r: number;
  discord_channel_id: string;
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

export function getArmiesAtHex(q: number, r: number): ArmyRow[] {
  return db.prepare('SELECT * FROM armies WHERE hex_q = ? AND hex_r = ?').all(q, r) as ArmyRow[];
}

export function getStrongholdAtHex(q: number, r: number): StrongholdRow | undefined {
  return db
    .prepare('SELECT s.* FROM strongholds s JOIN hexes h ON h.id = s.hex_id WHERE h.q = ? AND h.r = ?')
    .get(q, r) as StrongholdRow | undefined;
}

export function getCommanderByArmyId(armyId: number): CommanderRow | undefined {
  return db
    .prepare('SELECT c.* FROM commanders c JOIN armies a ON a.commander_id = c.id WHERE a.id = ?')
    .get(armyId) as CommanderRow | undefined;
}

export function getConferenceChannelForHex(q: number, r: number): ConferenceChannelRow | undefined {
  return db
    .prepare('SELECT * FROM conference_channels WHERE hex_q = ? AND hex_r = ?')
    .get(q, r) as ConferenceChannelRow | undefined;
}

export function saveConferenceChannel(q: number, r: number, channelId: string): void {
  db.prepare('INSERT OR REPLACE INTO conference_channels (hex_q, hex_r, discord_channel_id) VALUES (?, ?, ?)').run(q, r, channelId);
}

export function deleteConferenceChannel(channelId: string): void {
  db.prepare('DELETE FROM conference_channels WHERE discord_channel_id = ?').run(channelId);
}

export function getAllConferenceChannels(): ConferenceChannelRow[] {
  return db.prepare('SELECT * FROM conference_channels').all() as ConferenceChannelRow[];
}

export default db;
