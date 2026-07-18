import { OverwriteType, PermissionFlagsBits, type TextChannel } from 'discord.js';
import db, { deleteConferenceChannel, getAllConferenceChannels, getCommanderByArmyId, type CommanderRow } from './db.js';
import type { ArmySheetStats } from './sheets.js';
import { extractSheetId, fetchArmyStats, fetchDemands, syncArmySheet, writeGoods } from './sheets.js';
import {
  consumeSupplies,
  deliverMessages,
  postSupplyUpdates,
  processForage,
  processMovement,
  processNightMarchMovement,
  processSellOrders,
  validateArmyPositions,
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
  validateArmyPositions(db, statsMap, log);

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
    const movedArmyIds = processMovement(db, statsMap, log);
    processForage(db, statsMap, log, movingArmyIds);
    await runSellOrders(statsMap, log);
    await removeMoversFromConferences(movedArmyIds, client);
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

async function runSellOrders(statsMap: Map<number, ArmySheetStats>, log: string[]): Promise<void> {
  const openSellOrders = (
    db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE processed_at IS NULL AND type = 'sell'")
      .get() as { n: number }
  ).n;
  if (openSellOrders === 0) return;

  // If the Demands tab can't be read, skip sell processing entirely — running
  // with an empty demand list would wrongly cancel every open sell order.
  let demands;
  try {
    const fetched = await fetchDemands();
    demands = fetched.demands;
    log.push(...fetched.warnings);
  } catch (err) {
    log.push(
      `⚠️ Could not read the Demands tab — sell orders skipped this tick: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const changed = processSellOrders(db, statsMap, demands, log);

  // Selling is the one mechanic that changes the goods table, so the bot
  // rewrites it; everything else on the sheet's tables stays GM-owned.
  for (const armyId of changed) {
    const commander = getCommanderByArmyId(armyId);
    const sheetId = extractSheetId(commander?.army_sheet_url);
    const stats = statsMap.get(armyId);
    if (!sheetId || !stats) continue;
    try {
      await writeGoods(sheetId, stats.goods);
    } catch (err) {
      log.push(
        `⚠️ Failed to update goods on army ${armyId}'s sheet after selling: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

async function syncSheets(statsMap: Map<number, ArmySheetStats>, log: string[]): Promise<void> {
  const commanders = db.prepare('SELECT * FROM commanders').all() as CommanderRow[];
  const armies = db
    .prepare('SELECT id, commander_id FROM armies')
    .all() as { id: number; commander_id: number }[];

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
      await syncArmySheet(sheetId, stats);
      synced++;
    } catch (err) {
      log.push(`⚠️ Sheet sync failed for army ${army.id}: ${(err as Error).message}`);
    }
  }

  if (synced > 0) log.push(`📊 Army sheets synced (${synced}).`);
}

async function removeMoversFromConferences(
  movedArmyIds: Set<number>,
  client: TextChannel['client'],
): Promise<void> {
  if (movedArmyIds.size === 0) return;

  const conferences = getAllConferenceChannels();
  if (conferences.length === 0) return;

  for (const armyId of movedArmyIds) {
    const commander = getCommanderByArmyId(armyId);
    if (!commander?.discord_user_id) continue;

    for (const conf of conferences) {
      try {
        const ch = await client.channels.fetch(conf.discord_channel_id);
        if (!ch?.isTextBased()) continue;
        const textCh = ch as TextChannel;

        const overwrite = textCh.permissionOverwrites.cache.get(commander.discord_user_id);
        if (!overwrite) continue;

        const armyName = (db.prepare('SELECT name FROM armies WHERE id = ?').get(armyId) as { name: string | null } | undefined)?.name ?? `Army ${armyId}`;
        await textCh.permissionOverwrites.delete(commander.discord_user_id);
        await textCh.send(`📤 **${armyName}** has marched from the hex.`);

        const remaining = textCh.permissionOverwrites.cache.filter(
          (ow) => ow.type === OverwriteType.Member && ow.allow.has(PermissionFlagsBits.ViewChannel),
        );
        if (remaining.size === 0) {
          deleteConferenceChannel(conf.discord_channel_id);
          await textCh.delete();
        }
      } catch {
        // Channel unavailable or already deleted — continue
      }
    }
  }
}
