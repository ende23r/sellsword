import type { TextChannel } from 'discord.js';
import db, { type CommanderRow } from './db.js';
import type { ArmySheetStats } from './sheets.js';
import { extractSheetId, fetchArmyStats, syncArmySheet } from './sheets.js';
import {
  consumeSupplies,
  deliverMessages,
  postSupplyUpdates,
  processForage,
  processMovement,
  processNightMarchMovement,
} from './tick-processors.js';

export type UpdatePhase = 'morning' | 'noon' | 'night';

export async function runMessageDelivery(adminChannel: TextChannel): Promise<void> {
  const log: string[] = [];
  await deliverMessages(db, adminChannel.client, log);
  if (log.length > 0) await adminChannel.send(log.join('\n'));
}

export async function runDailyUpdate(phase: UpdatePhase, adminChannel: TextChannel): Promise<void> {
  const log: string[] = [`**Daily Update — ${phase.toUpperCase()}**`];
  const client = adminChannel.client;

  const statsMap = await fetchAllArmyStats(log);

  if (phase === 'morning') {
    processNightMarchMovement(db, statsMap, log);
    consumeSupplies(db, statsMap, log);
    await postSupplyUpdates(db, statsMap, client, log);
  }

  if (phase === 'night') {
    // Snapshot moving armies before processing — forage skips armies that moved.
    const movingArmyIds = new Set<number>(
      (
        db
          .prepare("SELECT army_id FROM orders WHERE processed_at IS NULL AND type = 'move'")
          .all() as { army_id: number }[]
      ).map((r) => r.army_id),
    );
    processMovement(db, statsMap, log);
    processForage(db, statsMap, log, movingArmyIds);
  }

  await deliverMessages(db, client, log);
  await syncSheets(statsMap, log);
  await adminChannel.send(log.join('\n'));
}

async function fetchAllArmyStats(log: string[]): Promise<Map<number, ArmySheetStats>> {
  const statsMap = new Map<number, ArmySheetStats>();
  const rows = db
    .prepare(
      `SELECT a.id, c.army_sheet_url
       FROM armies a JOIN commanders c ON c.id = a.commander_id`,
    )
    .all() as { id: number; army_sheet_url: string | null }[];

  for (const row of rows) {
    const sheetId = extractSheetId(row.army_sheet_url);
    if (!sheetId) continue;
    try {
      const stats = await fetchArmyStats(sheetId);
      statsMap.set(row.id, stats);
    } catch (err) {
      log.push(`⚠️ Failed to fetch stats for army ${row.id}: ${(err as Error).message}`);
    }
  }
  return statsMap;
}

async function syncSheets(statsMap: Map<number, ArmySheetStats>, log: string[]): Promise<void> {
  const commanders = db.prepare('SELECT * FROM commanders').all() as CommanderRow[];
  const armies = db
    .prepare('SELECT id, commander_id, hex_q, hex_r FROM armies')
    .all() as { id: number; commander_id: number; hex_q: number; hex_r: number }[];

  const armyByCommander = new Map(armies.map((a) => [a.commander_id, a]));
  let synced = 0;

  for (const commander of commanders) {
    const sheetId = extractSheetId(commander.army_sheet_url);
    if (!sheetId) continue;
    const army = armyByCommander.get(commander.id);
    if (!army) continue;
    const stats = statsMap.get(army.id);
    if (!stats) continue;
    try {
      await syncArmySheet(sheetId, stats, army.hex_q, army.hex_r);
      synced++;
    } catch (err) {
      log.push(`⚠️ Sheet sync failed for army ${army.id}: ${(err as Error).message}`);
    }
  }

  if (synced > 0) log.push(`📊 Army sheets synced (${synced}).`);
}
