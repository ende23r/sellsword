// Game loop processors — all functions take `database` as first arg so they can
// be tested with an in-memory DB without touching the live singleton.

import type Database from 'better-sqlite3';
import type { Client, TextChannel } from 'discord.js'; // type-only: no side effects
import type { ArmyRow, HexRow, OrderRow } from './db.js'; // type-only: no side effects
import { findPath, hexesInRange } from './hex.js';

type Log = string[];

// ── Supply consumption (morning tick) ────────────────────────────────────────

export function consumeSupplies(database: Database.Database, log: Log): void {
  const armies = database.prepare('SELECT * FROM armies').all() as ArmyRow[];
  const update = database.prepare('UPDATE armies SET supplies = MAX(0, supplies - ?) WHERE id = ?');
  const penalizeMorale = database.prepare(
    'UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ? AND supplies = 0',
  );

  for (const army of armies) {
    const consumption = army.infantry + army.noncombatants + (army.cavalry + army.wagons) * 10;
    update.run(consumption, army.id);
    if (army.supplies < consumption) {
      penalizeMorale.run(army.id);
      log.push(`⚠️ **${army.name ?? army.id}** ran out of supplies and lost 1 morale.`);
    }
  }
}

// ── Night march movement (morning tick) ──────────────────────────────────────

export function processNightMarchMovement(database: Database.Database, log: Log): void {
  const orders = database
    .prepare("SELECT * FROM orders WHERE processed_at IS NULL AND type = 'move'")
    .all() as OrderRow[];
  const validCoords = buildValidCoords(database);

  for (const order of orders) {
    const army = database
      .prepare('SELECT * FROM armies WHERE id = ?')
      .get(order.army_id) as ArmyRow | undefined;
    if (!army || !army.night_march) continue;

    const params = JSON.parse(order.parameters) as { roads_only: boolean };
    if (!params.roads_only) {
      log.push(`⚠️ **${army.name ?? army.id}** cannot night march off-road.`);
      continue;
    }

    // 6 miles/night = 1 hex; forced march adds another (12 miles = 2 hexes)
    const hexesAllowed = army.forced_march ? 2 : 1;
    advanceArmy(database, army, order, hexesAllowed, validCoords, log);
    rollMarchMorale(database, army, 'night', log);
  }
}

// ── Day movement (night tick) ─────────────────────────────────────────────────

export function processMovement(database: Database.Database, log: Log): void {
  const orders = database
    .prepare("SELECT * FROM orders WHERE processed_at IS NULL AND type = 'move'")
    .all() as OrderRow[];
  const validCoords = buildValidCoords(database);

  for (const order of orders) {
    const army = database
      .prepare('SELECT * FROM armies WHERE id = ?')
      .get(order.army_id) as ArmyRow | undefined;
    if (!army) continue;

    const params = JSON.parse(order.parameters) as { roads_only: boolean };
    const onRoad = params.roads_only;
    const forced = Boolean(army.forced_march);
    const cavalryOnly = army.infantry === 0 && army.wagons === 0;

    let milesPerDay: number;
    if (forced && cavalryOnly) {
      milesPerDay = 36;
    } else if (forced) {
      milesPerDay = 18;
    } else if (onRoad) {
      milesPerDay = 12;
    } else {
      milesPerDay = 6;
    }

    advanceArmy(database, army, order, Math.floor(milesPerDay / 6), validCoords, log);

    if (forced) {
      const refreshed = database
        .prepare('SELECT * FROM armies WHERE id = ?')
        .get(army.id) as ArmyRow;
      rollMarchMorale(database, refreshed, 'forced', log);
    }
  }

  checkArmyCollisions(database, log);
}

// ── Forage (night tick) ───────────────────────────────────────────────────────
// Forages current hex and all adjacent hexes. Cavalry extends range to 2 hexes.

export function processForage(
  database: Database.Database,
  log: Log,
  movingArmyIds: Set<number>,
): void {
  const orders = database
    .prepare("SELECT * FROM orders WHERE processed_at IS NULL AND type = 'forage'")
    .all() as OrderRow[];

  for (const order of orders) {
    if (movingArmyIds.has(order.army_id)) continue;

    const army = database
      .prepare('SELECT * FROM armies WHERE id = ?')
      .get(order.army_id) as ArmyRow | undefined;
    if (!army) continue;

    const range = army.cavalry > 0 ? 2 : 1;
    const hexCoords = hexesInRange({ q: army.hex_q, r: army.hex_r }, range);

    let totalYield = 0;
    let exhaustedCount = 0;

    for (const coord of hexCoords) {
      const hex = database
        .prepare('SELECT * FROM hexes WHERE q = ? AND r = ?')
        .get(coord.q, coord.r) as HexRow | undefined;
      if (!hex) continue;
      if (hex.forage_count >= 5) {
        exhaustedCount++;
        continue;
      }

      totalYield += hex.settlement * 500;
      database
        .prepare(
          "UPDATE hexes SET forage_count = forage_count + 1, last_foraged = date('now') WHERE q = ? AND r = ?",
        )
        .run(coord.q, coord.r);
    }

    if (totalYield > 0) {
      database
        .prepare('UPDATE armies SET supplies = supplies + ? WHERE id = ?')
        .run(totalYield, army.id);
      log.push(
        `🌾 **${army.name ?? army.id}** foraged ${totalYield.toLocaleString()} supplies` +
          (range === 2 ? ' (cavalry range, 2 hexes)' : '') +
          `.`,
      );
    } else {
      log.push(
        `⚠️ **${army.name ?? army.id}** foraged but found nothing` +
          (exhaustedCount > 0 ? ` (${exhaustedCount} exhausted hex${exhaustedCount > 1 ? 'es' : ''})` : '') +
          `.`,
      );
    }

    markOrderProcessed(database, order.id);
  }
}

// ── Message delivery (every tick) ────────────────────────────────────────────

export async function deliverMessages(
  database: Database.Database,
  client: Client,
  log: Log,
): Promise<void> {
  const pending = database
    .prepare(
      `SELECT m.id, m.content,
              sc.discord_user_id   AS sender_discord_id,
              rc.discord_channel_id AS recipient_channel_id
       FROM messages m
       JOIN commanders sc ON sc.id = m.sender_commander_id
       JOIN commanders rc ON rc.id = m.recipient_commander_id
       WHERE datetime(m.delivers_at) <= datetime('now') AND m.delivered = 0`,
    )
    .all() as {
    id: number;
    content: string;
    sender_discord_id: string;
    recipient_channel_id: string | null;
  }[];

  for (const msg of pending) {
    if (!msg.recipient_channel_id) {
      database.prepare('UPDATE messages SET delivered = 1 WHERE id = ?').run(msg.id);
      log.push(`⚠️ Message ${msg.id} could not be delivered — recipient has no army channel.`);
      continue;
    }
    try {
      const ch = await client.channels.fetch(msg.recipient_channel_id);
      if (ch?.isTextBased()) {
        await (ch as TextChannel).send(
          `📨 **Message from <@${msg.sender_discord_id}>**\n> ${msg.content}`,
        );
        database.prepare('UPDATE messages SET delivered = 1 WHERE id = ?').run(msg.id);
        log.push(`📨 Message delivered to channel ${msg.recipient_channel_id}.`);
      }
    } catch {
      log.push(`⚠️ Failed to deliver message ${msg.id}.`);
    }
  }
}

// ── Supply status notifications (morning tick) ────────────────────────────────

const UTC_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UTC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDateUTC(date: Date): string {
  const d = date.getUTCDate();
  const suffix = (d === 1 || d === 21 || d === 31) ? 'st'
    : (d === 2 || d === 22) ? 'nd'
    : (d === 3 || d === 23) ? 'rd'
    : 'th';
  return `${UTC_DAYS[date.getUTCDay()]}, ${UTC_MONTHS[date.getUTCMonth()]} ${d}${suffix}`;
}

export async function postSupplyUpdates(
  database: Database.Database,
  client: Client,
  log: Log,
  now: Date = new Date(),
): Promise<void> {
  const rows = database
    .prepare(
      `SELECT a.*, c.discord_channel_id, c.army_sheet_url
       FROM armies a
       JOIN commanders c ON c.id = a.commander_id`,
    )
    .all() as (ArmyRow & { discord_channel_id: string | null; army_sheet_url: string | null })[];

  for (const army of rows) {
    if (!army.discord_channel_id) continue;

    const consumption = army.infantry + army.noncombatants + (army.cavalry + army.wagons) * 10;
    const daysLeft = consumption > 0 ? Math.floor(army.supplies / consumption) : null;
    const sheetPart = army.army_sheet_url
      ? ` • [Open Sheet](<${army.army_sheet_url}>)`
      : '';

    let msg =
      `⚡ Status: ${army.name ?? 'Unknown'}\n` +
      `📅 ${formatDateUTC(now)} UTC${sheetPart}\n` +
      `📦 Supplies ${army.supplies.toLocaleString()} • 📉 Cons ${consumption.toLocaleString()}/d • ⏰ Days ${daysLeft ?? '∞'}`;

    if (daysLeft !== null) {
      const zeroDate = new Date(now.getTime() + daysLeft * 86400000);
      msg += `\n🚨 Zero Date ${formatDateUTC(zeroDate)} UTC`;
    }

    try {
      const ch = await client.channels.fetch(army.discord_channel_id);
      if (ch?.isTextBased()) {
        await (ch as TextChannel).send(msg);
      }
    } catch {
      log.push(`⚠️ Failed to post supply update to channel ${army.discord_channel_id}.`);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildValidCoords(database: Database.Database): Set<string> {
  const hexes = database.prepare('SELECT q, r FROM hexes').all() as { q: number; r: number }[];
  return new Set(hexes.map((h) => `${h.q},${h.r}`));
}

function advanceArmy(
  database: Database.Database,
  army: ArmyRow,
  order: OrderRow,
  hexesAllowed: number,
  validCoords: Set<string>,
  log: Log,
): void {
  const params = JSON.parse(order.parameters) as { dest_q: number; dest_r: number };
  const from = { q: army.hex_q, r: army.hex_r };
  const to = { q: params.dest_q, r: params.dest_r };

  if (from.q === to.q && from.r === to.r) {
    markOrderProcessed(database, order.id);
    return;
  }

  const path = findPath(from, to, validCoords);
  if (path.length === 0) {
    log.push(
      `⚠️ **${army.name ?? army.id}** has no valid path to (${to.q},${to.r}). Order cancelled.`,
    );
    markOrderProcessed(database, order.id);
    return;
  }

  const dest = path[Math.min(hexesAllowed, path.length) - 1];
  database
    .prepare('UPDATE armies SET hex_q = ?, hex_r = ? WHERE id = ?')
    .run(dest.q, dest.r, army.id);

  const reached = dest.q === to.q && dest.r === to.r;
  if (reached) markOrderProcessed(database, order.id);
  log.push(
    `🚶 **${army.name ?? army.id}** moved to (${dest.q},${dest.r})${reached ? ' — arrived' : ''}.`,
  );
}

export function rollMarchMorale(
  database: Database.Database,
  army: ArmyRow,
  type: 'forced' | 'night',
  log: Log,
): void {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  if (d1 === d2) {
    database
      .prepare('UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ?')
      .run(army.id);
    log.push(
      `😓 **${army.name ?? army.id}** lost 1 morale from ${type} march (rolled ${d1},${d2}).`,
    );
  }
}

function markOrderProcessed(database: Database.Database, orderId: number): void {
  database
    .prepare("UPDATE orders SET processed_at = datetime('now') WHERE id = ?")
    .run(orderId);
}

function checkArmyCollisions(database: Database.Database, log: Log): void {
  const armies = database.prepare('SELECT * FROM armies').all() as ArmyRow[];
  const byHex = new Map<string, ArmyRow[]>();
  for (const army of armies) {
    const key = `${army.hex_q},${army.hex_r}`;
    if (!byHex.has(key)) byHex.set(key, []);
    byHex.get(key)!.push(army);
  }
  for (const [hex, group] of byHex) {
    if (group.length > 1) {
      const names = group.map((a) => `**${a.name ?? a.id}**`).join(', ');
      log.push(`⚔️ Multiple armies at (${hex}): ${names}`);
    }
  }
}
