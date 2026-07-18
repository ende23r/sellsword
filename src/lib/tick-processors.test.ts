import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import type { ArmySheetStats } from './sheets.js';
import {
  consumeSupplies,
  deliverMessages,
  formatDateUTC,
  postSupplyUpdates,
  processForage,
  processMovement,
  supplyColor,
} from './tick-processors.js';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DB_SCHEMA);
  return db;
}

let seq = 0;

function seedArmy(
  db: Database.Database,
  overrides: {
    id?: number;
    name?: string;
    hex_q?: number;
    hex_r?: number;
  } = {},
): number {
  const id = overrides.id ?? ++seq;
  db.prepare('INSERT INTO commanders (id, discord_user_id) VALUES (?, ?)').run(
    id,
    `user-${id}`,
  );
  db.prepare(
    `INSERT INTO armies (id, commander_id, name, hex_q, hex_r) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    overrides.name ?? `Army ${id}`,
    overrides.hex_q ?? 0,
    overrides.hex_r ?? 0,
  );
  return id;
}

function makeStats(overrides: Partial<ArmySheetStats> = {}): ArmySheetStats {
  return {
    infantry: 1000,
    infantry_strength: 0,
    cavalry: 0,
    cavalry_strength: 0,
    wagons: 0,
    noncombatants: 0,
    scouting_range: 1,
    morale: 9,
    resting_morale: 9,
    max_morale: 12,
    supplies: 10000,
    coin: 0,
    goods: 0,
    stance: 'allow',
    forced_march: false,
    night_march: false,
    ...overrides,
  };
}

function seedHex(
  db: Database.Database,
  q: number,
  r: number,
  overrides: { settlement?: number; forage_count?: number; terrain?: string; speed?: number } = {},
): void {
  db.prepare(
    'INSERT OR IGNORE INTO hexes (q, r, terrain, settlement, roads, rivers, forage_count, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    q,
    r,
    overrides.terrain ?? 'flatland',
    overrides.settlement ?? 100,
    '[]',
    '[]',
    overrides.forage_count ?? 0,
    overrides.speed ?? 6,
  );
}

function seedOrder(
  db: Database.Database,
  armyId: number,
  type: string,
  params: object = {},
): number {
  db.prepare('INSERT INTO orders (army_id, type, parameters) VALUES (?, ?, ?)').run(
    armyId,
    type,
    JSON.stringify(params),
  );
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

// ── consumeSupplies ───────────────────────────────────────────────────────────

describe('consumeSupplies', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('deducts daily supply consumption', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 1000, cavalry: 0, noncombatants: 0, supplies: 5000 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.supplies).toBe(4000); // 1000 infantry × 1/day
  });

  it('does not reduce supplies below 0', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 100, supplies: 50 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.supplies).toBe(0);
  });

  it('reduces morale by 1 when army cannot pay', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 100, supplies: 50, morale: 9 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.morale).toBe(8);
  });

  it('does not reduce morale when army has enough supplies', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 100, supplies: 10000, morale: 9 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.morale).toBe(9);
  });

  it('does not reduce morale below 1', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 100, supplies: 0, morale: 1 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.morale).toBe(1);
  });
});

// ── processForage ─────────────────────────────────────────────────────────────

describe('processForage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('forages current hex and all 6 adjacent hexes', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0, supplies: 0, scouting_range: 1 })]]);
    // Center + 6 neighbors = 7 hexes
    for (const [q, r] of [
      [0, 0],
      [0, -1],
      [1, -1],
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
    ]) {
      seedHex(db, q, r, { settlement: 10 });
    }
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    expect(stats.get(armyId)!.supplies).toBe(7 * 10 * 500); // 35,000
  });

  it('skips exhausted hexes', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0, supplies: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 5 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    expect(stats.get(armyId)!.supplies).toBe(0);
  });

  it('skips armies in the moving set', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0, supplies: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set([armyId]));

    expect(stats.get(armyId)!.supplies).toBe(0);
  });

  it('extends range to 2 hexes when scouting_range is 2', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0, supplies: 0, scouting_range: 2 })]]);
    seedHex(db, 0, 0, { settlement: 10 }); // range 0
    seedHex(db, 0, 2, { settlement: 10 }); // range 2 (NW twice)
    seedHex(db, 2, -2, { settlement: 10 }); // range 2
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    // Must forage more than just the center hex
    expect(stats.get(armyId)!.supplies).toBeGreaterThan(10 * 500);
  });

  it('increments forage_count on each foraged hex', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 0 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    const hex = db.prepare('SELECT forage_count FROM hexes WHERE q = 0 AND r = 0').get() as {
      forage_count: number;
    };
    expect(hex.forage_count).toBe(1);
  });

  it('logs revolt risk when any foraged hex has been foraged before', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 1 });
    seedOrder(db, armyId, 'forage');

    const log: string[] = [];
    processForage(db, stats, log, new Set());

    expect(log.some((l) => l.toLowerCase().includes('revolt'))).toBe(true);
  });

  it('does not log revolt risk when all foraged hexes are fresh', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats({ infantry: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 0 });
    seedOrder(db, armyId, 'forage');

    const log: string[] = [];
    processForage(db, stats, log, new Set());

    expect(log.some((l) => l.toLowerCase().includes('revolt'))).toBe(false);
  });
});

// ── processMovement ───────────────────────────────────────────────────────────

describe('processMovement', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('moves army to adjacent destination and marks order processed', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });

    const moved = processMovement(db, stats, []);
    expect(moved.has(armyId)).toBe(true);

    const army = db.prepare('SELECT hex_q, hex_r FROM armies WHERE id = ?').get(armyId) as {
      hex_q: number;
      hex_r: number;
    };
    expect(army.hex_q).toBe(0);
    expect(army.hex_r).toBe(1);

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).not.toBeNull();
  });

  it('advances 1 hex per tick off-road, leaving order pending', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: false });

    processMovement(db, stats, []);

    const army = db.prepare('SELECT hex_r FROM armies WHERE id = ?').get(armyId) as {
      hex_r: number;
    };
    expect(army.hex_r).toBe(1); // 1 hex off-road

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).toBeNull();
  });

  it('advances 2 hexes per tick on road', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: true });

    processMovement(db, stats, []);

    const army = db.prepare('SELECT hex_r FROM armies WHERE id = ?').get(armyId) as {
      hex_r: number;
    };
    expect(army.hex_r).toBe(2); // 2 hexes on road
  });

  it('cannot path through a speed=0 hex', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);                    // passable
    seedHex(db, 0, 1, { speed: 0 });      // impassable — only route to (0,2)
    seedHex(db, 0, 2);                    // passable but unreachable
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 2, roads_only: false });

    const log: string[] = [];
    processMovement(db, stats, log);

    const army = db.prepare('SELECT hex_q, hex_r FROM armies WHERE id = ?').get(armyId) as { hex_q: number; hex_r: number };
    expect(army.hex_q).toBe(0);
    expect(army.hex_r).toBe(0);
    expect(log.some((l) => l.includes('no valid path'))).toBe(true);
  });

  it('off-road movement distance is determined by current hex speed', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0, { speed: 12 }); // double speed — should move 2 hexes off-road
    seedHex(db, 0, 1, { speed: 12 });
    seedHex(db, 0, 2, { speed: 12 });
    seedHex(db, 0, 3, { speed: 12 });
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: false });

    processMovement(db, stats, []);

    const army = db.prepare('SELECT hex_r FROM armies WHERE id = ?').get(armyId) as { hex_r: number };
    expect(army.hex_r).toBe(2);
  });

  it('cancels order and logs warning when no valid path exists', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedOrder(db, armyId, 'move', { dest_q: 9, dest_r: 9, roads_only: false });

    const log: string[] = [];
    processMovement(db, stats, log);

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).not.toBeNull();
    expect(log.some((l) => l.includes('no valid path'))).toBe(true);
  });

  it('returns empty set when no armies move', () => {
    const db2 = makeDb();
    const moved = processMovement(db2, new Map(), []);
    expect(moved.size).toBe(0);
  });

  it('does not include army in moved set when path fails', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedOrder(db, armyId, 'move', { dest_q: 9, dest_r: 9, roads_only: false });

    const moved = processMovement(db, stats, []);
    expect(moved.has(armyId)).toBe(false);
  });
});

// ── deliverMessages ───────────────────────────────────────────────────────────

describe('deliverMessages', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
    db.prepare(
      'INSERT INTO commanders (id, discord_user_id, discord_channel_id) VALUES (?, ?, ?)',
    ).run(100, 'sender-user', null);
    db.prepare(
      'INSERT INTO commanders (id, discord_user_id, discord_channel_id) VALUES (?, ?, ?)',
    ).run(101, 'recipient-user', 'ch-recipient');
  });

  function insertMessage(db: Database.Database, deliversAt: string, channelId?: string | null) {
    if (channelId !== undefined) {
      db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = 101').run(channelId);
    }
    db.prepare(
      'INSERT INTO messages (sender_commander_id, recipient_commander_id, content, delivers_at) VALUES (?, ?, ?, ?)',
    ).run(100, 101, 'Hello!', deliversAt);
  }

  it('delivers past-due messages and marks them delivered', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    insertMessage(db, past);

    const send = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }),
      },
    };

    await deliverMessages(db, mockClient as never, []);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain('Hello!');

    const msg = db.prepare('SELECT delivered FROM messages').get() as { delivered: number };
    expect(msg.delivered).toBe(1);
  });

  it('does not deliver future messages', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    insertMessage(db, future);

    const send = vi.fn();
    const mockClient = {
      channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) },
    };

    await deliverMessages(db, mockClient as never, []);

    expect(send).not.toHaveBeenCalled();
    const msg = db.prepare('SELECT delivered FROM messages').get() as { delivered: number };
    expect(msg.delivered).toBe(0);
  });

  it('marks as delivered and logs warning when recipient has no channel', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    insertMessage(db, past, null); // null channel

    const log: string[] = [];
    const mockClient = { channels: { fetch: vi.fn() } };

    await deliverMessages(db, mockClient as never, log);

    const msg = db.prepare('SELECT delivered FROM messages').get() as { delivered: number };
    expect(msg.delivered).toBe(1);
    expect(log.some((l) => l.includes('no army channel'))).toBe(true);
  });
});

// ── formatDateUTC ─────────────────────────────────────────────────────────────

describe('formatDateUTC', () => {
  it('formats a date with day name, month, and day', () => {
    expect(formatDateUTC(new Date('2026-07-16T00:00:00Z'))).toBe('Thursday, July 16th');
  });

  it('uses "st" for 1st, 21st, 31st', () => {
    expect(formatDateUTC(new Date('2026-07-01T00:00:00Z'))).toContain('1st');
    expect(formatDateUTC(new Date('2026-07-21T00:00:00Z'))).toContain('21st');
    expect(formatDateUTC(new Date('2026-07-31T00:00:00Z'))).toContain('31st');
  });

  it('uses "nd" for 2nd and 22nd', () => {
    expect(formatDateUTC(new Date('2026-07-02T00:00:00Z'))).toContain('2nd');
    expect(formatDateUTC(new Date('2026-07-22T00:00:00Z'))).toContain('22nd');
  });

  it('uses "rd" for 3rd and 23rd', () => {
    expect(formatDateUTC(new Date('2026-07-03T00:00:00Z'))).toContain('3rd');
    expect(formatDateUTC(new Date('2026-07-23T00:00:00Z'))).toContain('23rd');
  });

  it('uses "th" for 11th, 12th, 13th (special cases)', () => {
    expect(formatDateUTC(new Date('2026-07-11T00:00:00Z'))).toContain('11th');
    expect(formatDateUTC(new Date('2026-07-12T00:00:00Z'))).toContain('12th');
    expect(formatDateUTC(new Date('2026-07-13T00:00:00Z'))).toContain('13th');
  });
});

// ── supplyColor ───────────────────────────────────────────────────────────────

describe('supplyColor', () => {
  it('returns green for > 14 days or no consumption', () => {
    expect(supplyColor(15)).toBe(0x2ecc71);
    expect(supplyColor(null)).toBe(0x2ecc71);
  });

  it('returns yellow for 8–14 days', () => {
    expect(supplyColor(14)).toBe(0xf1c40f);
    expect(supplyColor(8)).toBe(0xf1c40f);
  });

  it('returns orange for 4–7 days', () => {
    expect(supplyColor(7)).toBe(0xe67e22);
    expect(supplyColor(4)).toBe(0xe67e22);
  });

  it('returns red for 1–3 days', () => {
    expect(supplyColor(3)).toBe(0xe74c3c);
    expect(supplyColor(1)).toBe(0xe74c3c);
  });

  it('returns dark red when out of supplies', () => {
    expect(supplyColor(0)).toBe(0x922b21);
  });
});

// ── postSupplyUpdates ─────────────────────────────────────────────────────────

describe('postSupplyUpdates', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  function makeClient(send: ReturnType<typeof vi.fn>) {
    return {
      channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) },
    };
  }

  function getEmbed(send: ReturnType<typeof vi.fn>) {
    const arg = send.mock.calls[0][0] as { embeds: { data: { title?: string; description?: string; color?: number; url?: string } }[] };
    return arg.embeds[0].data;
  }

  it('posts an embed to the army channel', async () => {
    const id = seedArmy(db, { name: 'Iron Legion' });
    const stats = new Map([[id, makeStats({ infantry: 1000, supplies: 5000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-1', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    expect(send).toHaveBeenCalledOnce();
    const embed = getEmbed(send);
    expect(embed.title).toContain('Iron Legion');
    expect(embed.description).toContain('Supplies');
    expect(embed.description).toContain('1,000/d');
    expect(embed.description).toContain('Days 5');
  });

  it('sets the embed color based on days remaining', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 1000, supplies: 5000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-1', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    expect(getEmbed(send).color).toBe(0xe67e22); // orange: 4–7 days
  });

  it('skips armies with no discord_channel_id', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 1000, supplies: 5000 })]]);

    const send = vi.fn();
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date());
    expect(send).not.toHaveBeenCalled();
  });

  it('skips armies with no stats entry', async () => {
    const id = seedArmy(db);
    // No entry in stats map
    const stats = new Map<number, ArmySheetStats>();
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-1', id);

    const send = vi.fn();
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date());
    expect(send).not.toHaveBeenCalled();
  });

  it('sets embed URL to army sheet when available', async () => {
    const id = seedArmy(db, { name: 'Riders' });
    const stats = new Map([[id, makeStats({ cavalry: 100, supplies: 10000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ?, army_sheet_url = ? WHERE id = ?')
      .run('ch-2', 'https://docs.google.com/spreadsheets/d/abc', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    expect(getEmbed(send).url).toBe('https://docs.google.com/spreadsheets/d/abc');
  });

  it('shows zero date in description when consumption > 0', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 1000, supplies: 3000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-3', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    const desc = getEmbed(send).description ?? '';
    expect(desc).toContain('Zero Date');
    expect(desc).toContain('July 19'); // 3000/1000 = 3 days out
  });

  it('omits zero date and shows ∞ when consumption is zero', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 0, cavalry: 0, supplies: 1000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-4', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date());

    const desc = getEmbed(send).description ?? '';
    expect(desc).toContain('∞');
    expect(desc).not.toContain('Zero Date');
  });

  it('logs a warning when channel fetch fails', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry: 1000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('bad-ch', id);

    const log: string[] = [];
    const badClient = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error('unknown channel')) },
    };
    await postSupplyUpdates(db, stats, badClient as never, log, new Date());
    expect(log.some((l) => l.includes('supply update'))).toBe(true);
  });
});
