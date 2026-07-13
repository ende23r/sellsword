import type { TextChannel } from 'discord.js';
import db, {
  getAllArmies,
  getDailySuppplyConsumption,
  getHex,
  getPendingOrders,
  markOrderProcessed,
} from './db.js';
import { syncAllArmySheets } from './sheets.js';

export type UpdatePhase = 'morning' | 'noon' | 'night';

export async function runDailyUpdate(phase: UpdatePhase, adminChannel: TextChannel): Promise<void> {
  const messages: string[] = [`**Daily Update — ${phase.toUpperCase()}**`];

  if (phase === 'morning') {
    processForage(messages);
    consumeSupplies(messages);
  }

  processMovement(messages, adminChannel);

  await syncSheets(messages);

  await adminChannel.send(messages.join('\n'));
}

// ── Forage ─────────────────────────────────────────────────────────────────

function processForage(log: string[]): void {
  const orders = getPendingOrders('forage');
  const updateArmy = db.prepare('UPDATE armies SET supplies = supplies + ? WHERE id = ?');
  const updateHex = db.prepare(
    'UPDATE hexes SET forage_count = forage_count + 1, last_foraged = date("now") WHERE q = ? AND r = ?',
  );

  for (const order of orders) {
    const army = db.prepare('SELECT * FROM armies WHERE id = ?').get(order.army_id) as
      { id: number; hex_q: number; hex_r: number; name: string | null } | undefined;
    if (!army) continue;

    const hex = getHex(army.hex_q, army.hex_r);
    if (!hex) continue;

    if (hex.forage_count >= 5) {
      log.push(
        `⚠️ Army **${army.name ?? army.id}** tried to forage an exhausted hex (${hex.q},${hex.r}).`,
      );
      markOrderProcessed(order.id);
      continue;
    }

    const gained = hex.settlement * 500;
    updateArmy.run(gained, army.id);
    updateHex.run(hex.q, hex.r);
    markOrderProcessed(order.id);
    log.push(
      `🌾 **${army.name ?? army.id}** foraged ${gained.toLocaleString()} supplies from (${hex.q},${hex.r}).`,
    );
  }
}

// ── Supply consumption ─────────────────────────────────────────────────────

function consumeSupplies(log: string[]): void {
  const armies = getAllArmies();
  const update = db.prepare('UPDATE armies SET supplies = MAX(0, supplies - ?) WHERE id = ?');
  const checkMorale = db.prepare(
    'UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ? AND supplies = 0',
  );

  for (const army of armies) {
    const consumption = getDailySuppplyConsumption(army);
    update.run(consumption, army.id);
    if (army.supplies < consumption) {
      checkMorale.run(army.id);
      log.push(`⚠️ Army **${army.name ?? army.id}** ran out of supplies and lost 1 morale.`);
    }
  }
}

// ── Movement ───────────────────────────────────────────────────────────────

function processMovement(log: string[], _adminChannel: TextChannel): void {
  const orders = getPendingOrders('move');
  const updatePos = db.prepare('UPDATE armies SET hex_q = ?, hex_r = ? WHERE id = ?');

  for (const order of orders) {
    const params = JSON.parse(order.parameters) as { dest_q: number; dest_r: number };
    const army = db.prepare('SELECT * FROM armies WHERE id = ?').get(order.army_id) as
      { id: number; hex_q: number; hex_r: number; name: string | null; wagons: number } | undefined;
    if (!army) continue;

    const destHex = getHex(params.dest_q, params.dest_r);
    if (!destHex) {
      log.push(
        `⚠️ Army **${army.name ?? army.id}**: move destination (${params.dest_q},${params.dest_r}) not found.`,
      );
      markOrderProcessed(order.id);
      continue;
    }

    updatePos.run(params.dest_q, params.dest_r, army.id);
    markOrderProcessed(order.id);
    log.push(`🚶 **${army.name ?? army.id}** moved to (${params.dest_q},${params.dest_r}).`);
  }

  // Check for armies sharing a hex and notify
  checkArmyCollisions(log);
}

function checkArmyCollisions(log: string[]): void {
  const armies = getAllArmies();
  const byHex = new Map<string, typeof armies>();
  for (const army of armies) {
    const key = `${army.hex_q},${army.hex_r}`;
    if (!byHex.has(key)) byHex.set(key, []);
    byHex.get(key)!.push(army);
  }
  for (const [hex, group] of byHex) {
    if (group.length > 1) {
      const names = group.map((a) => `**${a.name ?? a.id}**`).join(', ');
      log.push(`⚔️ Multiple armies at hex (${hex}): ${names}`);
    }
  }
}

// ── Sheet sync ─────────────────────────────────────────────────────────────

async function syncSheets(log: string[]): Promise<void> {
  try {
    const commanders = db.prepare('SELECT * FROM commanders').all() as Parameters<
      typeof syncAllArmySheets
    >[0];
    const armies = getAllArmies();
    await syncAllArmySheets(commanders, armies);
    log.push('📊 Army sheets synced.');
  } catch (err) {
    log.push(`⚠️ Sheet sync failed: ${(err as Error).message}`);
  }
}
