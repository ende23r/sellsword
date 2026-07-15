import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DB_SCHEMA } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../../sellsword.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(DB_SCHEMA);

// Migration: make factions.discord_category_id nullable if it was created NOT NULL.
const factionsCategoryCol = db
  .prepare("SELECT notnull FROM pragma_table_info('factions') WHERE name = 'discord_category_id'")
  .get() as { notnull: number } | undefined;
if (factionsCategoryCol?.notnull === 1) {
  db.exec(`
    CREATE TABLE factions_new (
      id                  INTEGER PRIMARY KEY,
      name                TEXT NOT NULL,
      discord_role_id     TEXT NOT NULL UNIQUE,
      discord_category_id TEXT UNIQUE
    );
    INSERT OR IGNORE INTO factions_new SELECT * FROM factions;
    DROP TABLE factions;
    ALTER TABLE factions_new RENAME TO factions;
  `);
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
