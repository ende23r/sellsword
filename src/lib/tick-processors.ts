// Game loop processors — all functions take `database` as first arg and `stats` as second
// so they can be tested with an in-memory DB and an injectable stats map without touching
// the live singleton or the Google Sheets API.

import type Database from 'better-sqlite3';
import { EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import type { ArmyRow, HexRow, OrderRow } from './db.js'; // type-only: no side effects
import type { ArmySheetStats } from './sheets.js';
import { findPath, hexesInRange } from './hex.js';

type Log = string[];

// ── Supply consumption (morning tick) ────────────────────────────────────────

export function consumeSupplies(
  database: Database.Database,
  stats: Map<number, ArmySheetStats>,
  log: Log,
): void {
  const armies = database.prepare('SELECT id, name FROM armies').all() as Pick<ArmyRow, 'id' | 'name'>[];

  for (const army of armies) {
    const s = stats.get(army.id);
    if (!s) continue;

    const consumption = s.infantry + s.noncombatants + (s.cavalry + s.wagons) * 10;
    const wasOut = s.supplies < consumption;
    s.supplies = Math.max(0, s.supplies - consumption);

    if (wasOut) {
      s.morale = Math.max(1, s.morale - 1);
      log.push(`⚠️ **${army.name ?? army.id}** ran out of supplies and lost 1 morale.`);
    }
  }
}

// ── Night march movement (morning tick) ──────────────────────────────────────

export function processNightMarchMovement(
  database: Database.Database,
  stats: Map<number, ArmySheetStats>,
  log: Log,
): void {
  const orders = database
    .prepare("SELECT * FROM orders WHERE processed_at IS NULL AND type = 'move'")
    .all() as OrderRow[];
  const validCoords = buildValidCoords(database);

  const factions = new Map<number, number | null>(
    (
      database
        .prepare('SELECT a.id, c.faction_id FROM armies a JOIN commanders c ON c.id = a.commander_id')
        .all() as { id: number; faction_id: number | null }[]
    ).map((r) => [r.id, r.faction_id]),
  );

  for (const order of orders) {
    const army = database
      .prepare('SELECT * FROM armies WHERE id = ?')
      .get(order.army_id) as ArmyRow | undefined;
    if (!army) continue;

    const s = stats.get(army.id);
    if (!s || !s.night_march) continue;

    const params = parseOrderParams(database, order, log);
    if (!params) continue;
    if (!params.roads_only) {
      log.push(`⚠️ **${army.name ?? army.id}** cannot night march off-road.`);
      continue;
    }

    // 6 miles/night = 1 hex; forced march adds another (12 miles = 2 hexes)
    const hexesAllowed = s.forced_march ? 2 : 1;
    advanceArmy(database, army, order, params, hexesAllowed, validCoords, stats, factions, log);
    rollMarchMorale(stats, army.id, army.name ?? String(army.id), 'night', log);
  }
}

// ── Day movement (night tick) ─────────────────────────────────────────────────

export function processMovement(
  database: Database.Database,
  stats: Map<number, ArmySheetStats>,
  log: Log,
): Set<number> {
  const moved = new Set<number>();
  const orders = database
    .prepare("SELECT * FROM orders WHERE processed_at IS NULL AND type = 'move'")
    .all() as OrderRow[];
  const validCoords = buildValidCoords(database);

  // Faction map for engage interception checks
  const factions = new Map<number, number | null>(
    (
      database
        .prepare('SELECT a.id, c.faction_id FROM armies a JOIN commanders c ON c.id = a.commander_id')
        .all() as { id: number; faction_id: number | null }[]
    ).map((r) => [r.id, r.faction_id]),
  );

  for (const order of orders) {
    const army = database
      .prepare('SELECT * FROM armies WHERE id = ?')
      .get(order.army_id) as ArmyRow | undefined;
    if (!army) continue;

    const s = stats.get(army.id);
    if (!s) continue;

    const params = parseOrderParams(database, order, log);
    if (!params) continue;
    const onRoad = params.roads_only;
    const forced = s.forced_march;
    const cavalryOnly = s.infantry === 0 && s.wagons === 0;

    const currentHex = database
      .prepare('SELECT speed FROM hexes WHERE q = ? AND r = ?')
      .get(s.hex_q, s.hex_r) as { speed: number } | undefined;
    const hexSpeed = currentHex?.speed ?? 6;

    let speedMultiplier: number;
    if (forced && cavalryOnly) speedMultiplier = 6;
    else if (forced) speedMultiplier = 3;
    else if (onRoad) speedMultiplier = 2;
    else speedMultiplier = 1;

    const hexesAllowed = Math.floor((hexSpeed * speedMultiplier) / 6);
    if (hexesAllowed === 0) continue;

    const didMove = advanceArmy(database, army, order, params, hexesAllowed, validCoords, stats, factions, log);
    if (didMove) moved.add(army.id);

    if (forced) {
      rollMarchMorale(stats, army.id, army.name ?? String(army.id), 'forced', log);
    }
  }

  checkArmyCollisions(database, stats, factions, log);
  return moved;
}

// ── Forage (night tick) ───────────────────────────────────────────────────────

export function processForage(
  database: Database.Database,
  stats: Map<number, ArmySheetStats>,
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

    const s = stats.get(army.id);
    if (!s) continue;

    const range = s.scouting_range;
    const hexCoords = hexesInRange({ q: s.hex_q, r: s.hex_r }, range);

    let totalYield = 0;
    let exhaustedCount = 0;
    let revoltCount = 0;

    for (const coord of hexCoords) {
      const hex = database
        .prepare('SELECT * FROM hexes WHERE q = ? AND r = ?')
        .get(coord.q, coord.r) as HexRow | undefined;
      if (!hex) continue;
      if (hex.forage_count >= 5) {
        exhaustedCount++;
        continue;
      }

      if (hex.forage_count >= 1) revoltCount++;
      totalYield += hex.settlement * 500;
      database
        .prepare(
          "UPDATE hexes SET forage_count = forage_count + 1, last_foraged = date('now') WHERE q = ? AND r = ?",
        )
        .run(coord.q, coord.r);
    }

    if (totalYield > 0) {
      s.supplies += totalYield;
      log.push(
        `🌾 **${army.name ?? army.id}** foraged ${totalYield.toLocaleString()} supplies` +
          (range > 1 ? ` (scouting range ${range} hexes)` : '') +
          `.`,
      );
    } else {
      log.push(
        `⚠️ **${army.name ?? army.id}** foraged but found nothing` +
          (exhaustedCount > 0 ? ` (${exhaustedCount} exhausted hex${exhaustedCount > 1 ? 'es' : ''})` : '') +
          `.`,
      );
    }

    if (revoltCount > 0) {
      log.push(
        `⚠️ **Revolt risk:** **${army.name ?? army.id}** foraged ${revoltCount} previously-foraged hex${revoltCount > 1 ? 'es' : ''}.`,
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

export function supplyColor(daysLeft: number | null): number {
  if (daysLeft === null || daysLeft > 14) return 0x2ecc71; // green
  if (daysLeft >= 8) return 0xf1c40f;                      // yellow
  if (daysLeft >= 4) return 0xe67e22;                      // orange
  if (daysLeft >= 1) return 0xe74c3c;                      // red
  return 0x922b21;                                          // dark red (out)
}

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
  stats: Map<number, ArmySheetStats>,
  client: Client,
  log: Log,
  now: Date = new Date(),
): Promise<void> {
  const rows = database
    .prepare(
      `SELECT a.id, a.name, c.discord_channel_id, c.army_sheet_url
       FROM armies a
       JOIN commanders c ON c.id = a.commander_id`,
    )
    .all() as (ArmyRow & { discord_channel_id: string | null; army_sheet_url: string | null })[];

  for (const army of rows) {
    if (!army.discord_channel_id) continue;

    const s = stats.get(army.id);
    if (!s) continue;

    const consumption = s.infantry + s.noncombatants + (s.cavalry + s.wagons) * 10;
    const daysLeft = consumption > 0 ? Math.floor(s.supplies / consumption) : null;

    let description =
      `📅 ${formatDateUTC(now)} UTC\n` +
      `📦 Supplies ${s.supplies.toLocaleString()} • 📉 Cons ${consumption.toLocaleString()}/d • ⏰ Days ${daysLeft ?? '∞'}`;

    if (daysLeft !== null) {
      const zeroDate = new Date(now.getTime() + daysLeft * 86400000);
      description += `\n🚨 Zero Date ${formatDateUTC(zeroDate)} UTC`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`⚡ Status: ${army.name ?? 'Unknown'}`)
      .setColor(supplyColor(daysLeft))
      .setDescription(description);

    if (army.army_sheet_url) embed.setURL(army.army_sheet_url);

    try {
      const ch = await client.channels.fetch(army.discord_channel_id);
      if (ch?.isTextBased()) {
        await (ch as TextChannel).send({ embeds: [embed] });
      }
    } catch {
      log.push(`⚠️ Failed to post supply update to channel ${army.discord_channel_id}.`);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildValidCoords(database: Database.Database): Set<string> {
  const hexes = database.prepare('SELECT q, r FROM hexes WHERE speed > 0').all() as { q: number; r: number }[];
  return new Set(hexes.map((h) => `${h.q},${h.r}`));
}

type MoveOrderParams = { dest_q: number; dest_r: number; roads_only: boolean };

// A malformed parameters blob must not abort the whole tick loop — cancel just that order.
function parseOrderParams(
  database: Database.Database,
  order: OrderRow,
  log: Log,
): MoveOrderParams | null {
  try {
    return JSON.parse(order.parameters) as MoveOrderParams;
  } catch {
    log.push(`⚠️ Order ${order.id} (army ${order.army_id}) has malformed parameters — order cancelled.`);
    markOrderProcessed(database, order.id);
    return null;
  }
}

function advanceArmy(
  database: Database.Database,
  army: ArmyRow,
  order: OrderRow,
  params: MoveOrderParams,
  hexesAllowed: number,
  validCoords: Set<string>,
  stats: Map<number, ArmySheetStats>,
  factions: Map<number, number | null>,
  log: Log,
): boolean {
  const s = stats.get(army.id);
  if (!s) return false;

  const from = { q: s.hex_q, r: s.hex_r };
  const to = { q: params.dest_q, r: params.dest_r };

  if (from.q === to.q && from.r === to.r) {
    markOrderProcessed(database, order.id);
    return false;
  }

  const path = findPath(from, to, validCoords);
  if (path.length === 0) {
    log.push(
      `⚠️ **${army.name ?? army.id}** has no valid path to (${to.q},${to.r}). Order cancelled.`,
    );
    markOrderProcessed(database, order.id);
    return false;
  }

  // Walk the path step by step; stop early if an engaging enemy is encountered
  const myFaction = factions.get(army.id);
  const stepsAllowed = Math.min(hexesAllowed, path.length);
  let destIndex = stepsAllowed - 1;
  for (let i = 0; i < stepsAllowed; i++) {
    const step = path[i];
    let intercepted = false;
    for (const [otherId, os] of stats) {
      if (otherId !== army.id && os.hex_q === step.q && os.hex_r === step.r) {
        if (os.stance === 'engage' && factions.get(otherId) !== myFaction) {
          intercepted = true;
          break;
        }
      }
    }
    if (intercepted) {
      destIndex = i;
      break;
    }
  }

  const dest = path[destIndex];
  // Write new position into stats (sheet sync happens after tick)
  s.hex_q = dest.q;
  s.hex_r = dest.r;

  const reached = dest.q === to.q && dest.r === to.r;
  if (reached) markOrderProcessed(database, order.id);
  log.push(
    `🚶 **${army.name ?? army.id}** moved to (${dest.q},${dest.r})${reached ? ' — arrived' : ''}.`,
  );
  return true;
}

export function rollMarchMorale(
  stats: Map<number, ArmySheetStats>,
  armyId: number,
  armyName: string,
  type: 'forced' | 'night',
  log: Log,
): void {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  if (d1 === d2) {
    const s = stats.get(armyId);
    if (s) s.morale = Math.max(1, s.morale - 1);
    log.push(
      `😓 **${armyName}** lost 1 morale from ${type} march (rolled ${d1},${d2}).`,
    );
  }
}

function markOrderProcessed(database: Database.Database, orderId: number): void {
  database
    .prepare("UPDATE orders SET processed_at = datetime('now') WHERE id = ?")
    .run(orderId);
}

function checkArmyCollisions(
  database: Database.Database,
  stats: Map<number, ArmySheetStats>,
  factions: Map<number, number | null>,
  log: Log,
): void {
  // Group army IDs by hex position (from stats)
  const byHex = new Map<string, number[]>();
  for (const [id, s] of stats) {
    const key = `${s.hex_q},${s.hex_r}`;
    if (!byHex.has(key)) byHex.set(key, []);
    byHex.get(key)!.push(id);
  }

  // Fetch army names for log messages
  const getName = (id: number): string => {
    const row = database.prepare('SELECT name FROM armies WHERE id = ?').get(id) as { name: string | null } | undefined;
    return row?.name ?? String(id);
  };

  for (const [hex, ids] of byHex) {
    if (ids.length < 2) continue;
    const engagerIds = ids.filter((id) => stats.get(id)?.stance === 'engage');
    if (engagerIds.length === 0) continue;
    const factionsPresent = new Set(ids.map((id) => factions.get(id)));
    if (factionsPresent.size < 2) continue;

    for (const engagerId of engagerIds) {
      const enemyIds = ids.filter(
        (id) => id !== engagerId && factions.get(id) !== factions.get(engagerId),
      );
      if (enemyIds.length === 0) continue;
      const engagerName = getName(engagerId);
      const enemyNames = enemyIds.map((id) => `**${getName(id)}**`).join(', ');
      log.push(
        `⚔️ **ENGAGE** at (${hex}): **${engagerName}** intercepted ${enemyNames}. Use \`/battle army_a:${engagerId}\` to resolve.`,
      );
    }
  }
}
