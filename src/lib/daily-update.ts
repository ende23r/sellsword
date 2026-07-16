import type { TextChannel } from 'discord.js';
import db, { getAllArmies, type CommanderRow } from './db.js';
import {
  consumeSupplies,
  deliverMessages,
  postSupplyUpdates,
  processForage,
  processMovement,
  processNightMarchMovement,
} from './tick-processors.js';
import { syncAllArmySheets } from './sheets.js';

export type UpdatePhase = 'morning' | 'noon' | 'night';

export async function runDailyUpdate(phase: UpdatePhase, adminChannel: TextChannel): Promise<void> {
  const log: string[] = [`**Daily Update — ${phase.toUpperCase()}**`];
  const client = adminChannel.client;

  if (phase === 'morning') {
    processNightMarchMovement(db, log);
    consumeSupplies(db, log);
    await postSupplyUpdates(db, client, log);
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
    processMovement(db, log);
    processForage(db, log, movingArmyIds);
  }

  await deliverMessages(db, client, log);
  await syncSheets(log);
  await adminChannel.send(log.join('\n'));
}

async function syncSheets(log: string[]): Promise<void> {
  try {
    const commanders = db.prepare('SELECT * FROM commanders').all() as CommanderRow[];
    const armies = getAllArmies();
    await syncAllArmySheets(commanders, armies);
    log.push('📊 Army sheets synced.');
  } catch (err) {
    log.push(`⚠️ Sheet sync failed: ${(err as Error).message}`);
  }
}
