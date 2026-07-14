import type { TextChannel } from 'discord.js';
import db, {
  type ArmyRow,
  type OrderRow,
  getAllArmies,
  getAllHexes,
  getDailySuppplyConsumption,
  getHex,
  getPendingOrders,
  markOrderProcessed,
} from './db.js';
import { findPath } from './hex.js';
import { syncAllArmySheets } from './sheets.js';

export type UpdatePhase = 'morning' | 'noon' | 'night';

export async function runDailyUpdate(phase: UpdatePhase, adminChannel: TextChannel): Promise<void> {
  const messages: string[] = [`**Daily Update — ${phase.toUpperCase()}**`];

  if (phase === 'morning') {
    processNightMarchMovement(messages);
    consumeSupplies(messages);
  }

  if (phase === 'night') {
    // Snapshot moving armies before processing so forage can exclude them.
    const movingArmyIds = new Set(getPendingOrders('move').map((o) => o.army_id));
    processMovement(messages);
    processForage(messages, movingArmyIds);
  }

  await syncSheets(messages);
  await adminChannel.send(messages.join('\n'));
}

// ── Night march movement (morning tick) ────────────────────────────────────

function processNightMarchMovement(log: string[]): void {
  const orders = getPendingOrders('move');
  const validCoords = buildValidCoords();

  for (const order of orders) {
    const army = db.prepare('SELECT * FROM armies WHERE id = ?').get(order.army_id) as
      ArmyRow | undefined;
    if (!army || !army.night_march) continue;

    const params = JSON.parse(order.parameters) as { roads_only: boolean };
    if (!params.roads_only) {
      log.push(`⚠️ **${army.name ?? army.id}** cannot night march off-road.`);
      continue;
    }

    // 6 miles/night = 1 hex; 12 miles at forced march = 2 hexes
    const hexesAllowed = army.forced_march ? 2 : 1;
    advanceArmy(army, order, hexesAllowed, validCoords, log);
    rollMarchMorale(army, 'night', log);
  }
}

// ── Supply consumption (morning tick) ──────────────────────────────────────

function consumeSupplies(log: string[]): void {
  const armies = getAllArmies();
  const update = db.prepare('UPDATE armies SET supplies = MAX(0, supplies - ?) WHERE id = ?');
  const penalizeMorale = db.prepare(
    'UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ? AND supplies = 0',
  );

  for (const army of armies) {
    const consumption = getDailySuppplyConsumption(army);
    update.run(consumption, army.id);
    if (army.supplies < consumption) {
      penalizeMorale.run(army.id);
      log.push(`⚠️ **${army.name ?? army.id}** ran out of supplies and lost 1 morale.`);
    }
  }
}

// ── Day movement (night tick) ───────────────────────────────────────────────

function processMovement(log: string[]): void {
  const orders = getPendingOrders('move');
  const validCoords = buildValidCoords();

  for (const order of orders) {
    const army = db.prepare('SELECT * FROM armies WHERE id = ?').get(order.army_id) as
      ArmyRow | undefined;
    if (!army) continue;

    const params = JSON.parse(order.parameters) as { roads_only: boolean };
    const onRoad = params.roads_only;
    const forced = Boolean(army.forced_march);
    // Armies of exclusively cavalry (no infantry, no wagons) double their forced march pace.
    const cavalryOnly = army.infantry === 0 && army.wagons === 0;

    let milesPerDay: number;
    if (forced && cavalryOnly) {
      milesPerDay = 36; // double forced march (36 mi/day on or off road)
    } else if (forced) {
      milesPerDay = 18;
    } else if (onRoad) {
      milesPerDay = 12;
    } else {
      milesPerDay = 6;
    }

    advanceArmy(army, order, Math.floor(milesPerDay / 6), validCoords, log);

    if (forced) {
      const refreshed = db.prepare('SELECT * FROM armies WHERE id = ?').get(army.id) as ArmyRow;
      rollMarchMorale(refreshed, 'forced', log);
    }
  }

  checkArmyCollisions(log);
}

// ── Forage (night tick) ─────────────────────────────────────────────────────

function processForage(log: string[], movingArmyIds: Set<number>): void {
  const orders = getPendingOrders('forage');

  for (const order of orders) {
    if (movingArmyIds.has(order.army_id)) continue; // moving armies can't forage

    const army = db.prepare('SELECT * FROM armies WHERE id = ?').get(order.army_id) as
      ArmyRow | undefined;
    if (!army) continue;

    const hex = getHex(army.hex_q, army.hex_r);
    if (!hex) continue;

    if (hex.forage_count >= 5) {
      log.push(
        `⚠️ **${army.name ?? army.id}** tried to forage an exhausted hex (${hex.q},${hex.r}).`,
      );
      markOrderProcessed(order.id);
      continue;
    }

    const gained = hex.settlement * 500;
    db.prepare('UPDATE armies SET supplies = supplies + ? WHERE id = ?').run(gained, army.id);
    db.prepare(
      'UPDATE hexes SET forage_count = forage_count + 1, last_foraged = date("now") WHERE q = ? AND r = ?',
    ).run(hex.q, hex.r);
    markOrderProcessed(order.id);
    log.push(
      `🌾 **${army.name ?? army.id}** foraged ${gained.toLocaleString()} supplies from (${hex.q},${hex.r}).`,
    );
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function buildValidCoords(): Set<string> {
  return new Set(getAllHexes().map((h) => `${h.q},${h.r}`));
}

function advanceArmy(
  army: ArmyRow,
  order: OrderRow,
  hexesAllowed: number,
  validCoords: Set<string>,
  log: string[],
): void {
  const params = JSON.parse(order.parameters) as { dest_q: number; dest_r: number };
  const from = { q: army.hex_q, r: army.hex_r };
  const to = { q: params.dest_q, r: params.dest_r };

  if (from.q === to.q && from.r === to.r) {
    markOrderProcessed(order.id);
    return;
  }

  const path = findPath(from, to, validCoords);
  if (path.length === 0) {
    log.push(
      `⚠️ **${army.name ?? army.id}** has no valid path to (${to.q},${to.r}). Order cancelled.`,
    );
    markOrderProcessed(order.id);
    return;
  }

  const dest = path[Math.min(hexesAllowed, path.length) - 1];
  db.prepare('UPDATE armies SET hex_q = ?, hex_r = ? WHERE id = ?').run(dest.q, dest.r, army.id);

  const reached = dest.q === to.q && dest.r === to.r;
  if (reached) markOrderProcessed(order.id);
  log.push(
    `🚶 **${army.name ?? army.id}** moved to (${dest.q},${dest.r})${reached ? ' — arrived' : ''}.`,
  );
}

function rollMarchMorale(army: ArmyRow, type: 'forced' | 'night', log: string[]): void {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  if (d1 === d2) {
    db.prepare('UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ?').run(army.id);
    log.push(
      `😓 **${army.name ?? army.id}** lost 1 morale from ${type} march (rolled ${d1},${d2}).`,
    );
  }
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
