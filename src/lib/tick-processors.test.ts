import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import type { ArmySheetStats, Detachment } from './sheets.js';
import {
  consumeSupplies,
  deliverMessages,
  formatDateUTC,
  formatTickDuration,
  postMovedArmyMaps,
  postSellNotifications,
  postSupplyUpdates,
  processForage,
  processMovement,
  processNightMarchMovement,
  processSellOrders,
  rollMarchMorale,
  supplyColor,
  validateArmyPositions,
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
    faction_id?: number;
  } = {},
): number {
  const id = overrides.id ?? ++seq;
  db.prepare('INSERT INTO commanders (id, discord_user_id, faction_id) VALUES (?, ?, ?)').run(
    id,
    `user-${id}`,
    overrides.faction_id ?? null,
  );
  db.prepare(`INSERT INTO armies (id, commander_id, name) VALUES (?, ?, ?)`).run(
    id,
    id,
    overrides.name ?? `Army ${id}`,
  );
  return id;
}

function det(overrides: Partial<Detachment> = {}): Detachment {
  return { name: 'Foot', size: 1000, notes: '', multiplier: 1, strength: 0, wagons: 0, ...overrides };
}

function makeStats(overrides: Partial<ArmySheetStats> = {}): ArmySheetStats {
  return {
    infantry_detachments: [det()],
    cavalry_detachments: [],
    noncombatants: 0,
    scouting_range: 1,
    morale: 9,
    resting_morale: 9,
    max_morale: 12,
    supplies: 10000,
    coin: 0,
    goods: [],
    hex_q: 0,
    hex_r: 0,
    stance: 'allow_passage',
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

// ── validateArmyPositions ─────────────────────────────────────────────────────

describe('validateArmyPositions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('keeps armies whose sheet position is on the map', () => {
    const id = seedArmy(db);
    seedHex(db, 3, -2);
    const stats = new Map([[id, makeStats({ hex_q: 3, hex_r: -2 })]]);
    const log: string[] = [];
    validateArmyPositions(db, stats, log);
    expect(stats.has(id)).toBe(true);
    expect(log).toEqual([]);
  });

  it('drops armies whose sheet position is off the map and warns', () => {
    const goodId = seedArmy(db);
    const badId = seedArmy(db);
    seedHex(db, 0, 0);
    const stats = new Map([
      [goodId, makeStats({ hex_q: 0, hex_r: 0 })],
      [badId, makeStats({ hex_q: 99, hex_r: 99 })],
    ]);
    const log: string[] = [];
    validateArmyPositions(db, stats, log);
    expect(stats.has(goodId)).toBe(true);
    expect(stats.has(badId)).toBe(false);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain(`army ${badId}`);
    expect(log[0]).toContain('(99,99)');
  });
});

// ── processSellOrders ─────────────────────────────────────────────────────────

describe('processSellOrders', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  const silkDemand = { hex_q: 0, hex_r: 0, good: 'silk', price: 2, volume: 500 };

  it('sells all held goods when under the market volume and completes the order', () => {
    const id = seedArmy(db, { name: 'Iron Legion' });
    const orderId = seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 300 }], coin: 0 })]]);
    const log: string[] = [];

    const sales = processSellOrders(db, stats, [silkDemand], log);

    expect(stats.get(id)!.coin).toBe(600); // 300 × 2
    expect(stats.get(id)!.goods).toEqual([]);
    expect(new Set(sales.keys())).toEqual(new Set([id]));
    const order = db.prepare('SELECT processed_at FROM orders WHERE id = ?').get(orderId) as { processed_at: string | null };
    expect(order.processed_at).not.toBeNull();
    expect(log.join('\n')).toContain('Iron Legion');
    expect(log.join('\n')).toContain('300');
  });

  it('caps daily sales at the demand volume and keeps the order open', () => {
    const id = seedArmy(db);
    const orderId = seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 800 }], coin: 0 })]]);

    processSellOrders(db, stats, [silkDemand], []);

    expect(stats.get(id)!.coin).toBe(1000); // 500 × 2
    expect(stats.get(id)!.goods).toEqual([{ name: 'silk', count: 300 }]);
    const order = db.prepare('SELECT processed_at FROM orders WHERE id = ?').get(orderId) as { processed_at: string | null };
    expect(order.processed_at).toBeNull(); // still selling tomorrow
  });

  it('splits the volume evenly among sellers of the same good in the hex', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    seedOrder(db, a, 'sell');
    seedOrder(db, b, 'sell');
    const stats = new Map([
      [a, makeStats({ goods: [{ name: 'silk', count: 400 }], coin: 0 })],
      [b, makeStats({ goods: [{ name: 'silk', count: 400 }], coin: 0 })],
    ]);

    processSellOrders(db, stats, [silkDemand], []);

    // 500 volume / 2 sellers = 250 each
    expect(stats.get(a)!.coin).toBe(500);
    expect(stats.get(b)!.coin).toBe(500);
    expect(stats.get(a)!.goods).toEqual([{ name: 'silk', count: 150 }]);
    expect(stats.get(b)!.goods).toEqual([{ name: 'silk', count: 150 }]);
  });

  it('a seller holding less than its share sells only what it has', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    seedOrder(db, a, 'sell');
    seedOrder(db, b, 'sell');
    const stats = new Map([
      [a, makeStats({ goods: [{ name: 'silk', count: 100 }], coin: 0 })],
      [b, makeStats({ goods: [{ name: 'silk', count: 400 }], coin: 0 })],
    ]);

    processSellOrders(db, stats, [silkDemand], []);

    expect(stats.get(a)!.coin).toBe(200); // all 100
    expect(stats.get(b)!.coin).toBe(500); // its 250 share
  });

  it('only sells goods matching a demand — the rest stay in inventory', () => {
    const id = seedArmy(db);
    const orderId = seedOrder(db, id, 'sell');
    const stats = new Map([
      [id, makeStats({ goods: [{ name: 'silk', count: 100 }, { name: 'furs', count: 50 }], coin: 0 })],
    ]);

    processSellOrders(db, stats, [silkDemand], []);

    expect(stats.get(id)!.coin).toBe(200);
    expect(stats.get(id)!.goods).toEqual([{ name: 'furs', count: 50 }]);
    // No demand for furs → nothing marketable left → order complete
    const order = db.prepare('SELECT processed_at FROM orders WHERE id = ?').get(orderId) as { processed_at: string | null };
    expect(order.processed_at).not.toBeNull();
  });

  it('matches good names case-insensitively', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'Silk', count: 100 }], coin: 0 })]]);

    processSellOrders(db, stats, [silkDemand], []);

    expect(stats.get(id)!.coin).toBe(200);
  });

  it('ignores demands in other hexes', () => {
    const id = seedArmy(db);
    const orderId = seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 100 }], coin: 0, hex_q: 5, hex_r: 5 })]]);
    const log: string[] = [];

    const sales = processSellOrders(db, stats, [silkDemand], log);

    expect(stats.get(id)!.coin).toBe(0);
    expect(stats.get(id)!.goods).toEqual([{ name: 'silk', count: 100 }]);
    expect(sales.size).toBe(0);
    // Nothing sellable here — order cancelled with a warning
    const order = db.prepare('SELECT processed_at FROM orders WHERE id = ?').get(orderId) as { processed_at: string | null };
    expect(order.processed_at).not.toBeNull();
    expect(log.join('\n')).toContain('nothing to sell');
  });

  it('returns player-facing sale lines per army, noting completion', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 300 }], coin: 0 })]]);

    const sales = processSellOrders(db, stats, [silkDemand], []);

    const lines = sales.get(id)!;
    expect(lines.join('\n')).toContain('300');
    expect(lines.join('\n')).toContain('silk');
    expect(lines.join('\n')).toContain('600');
    expect(lines.join('\n')).toContain('complete');
  });

  it('does not note completion in sale lines while the order stays open', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 800 }], coin: 0 })]]);

    const sales = processSellOrders(db, stats, [silkDemand], []);

    expect(sales.get(id)!.join('\n')).not.toContain('complete');
  });

  it('rounds coin from fractional prices', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'sell');
    const stats = new Map([[id, makeStats({ goods: [{ name: 'silk', count: 101 }], coin: 0 })]]);

    processSellOrders(db, stats, [{ ...silkDemand, price: 0.5 }], []);

    expect(stats.get(id)!.coin).toBe(51); // round(101 × 0.5)
  });
});

// ── postSellNotifications ─────────────────────────────────────────────────────

describe('postSellNotifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  function setChannel(db: Database.Database, commanderId: number, channelId: string | null) {
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run(
      channelId,
      commanderId,
    );
  }

  it('pings each selling army in its channel with its sale lines', async () => {
    const id = seedArmy(db);
    setChannel(db, id, 'ch-army');
    const sales = new Map([[id, ['Sold 300 silk for 600 coin.']]]);

    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ isTextBased: () => true, send });
    const mockClient = { channels: { fetch } };

    await postSellNotifications(db, sales, mockClient as never, []);

    expect(fetch).toHaveBeenCalledWith('ch-army');
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0][0] as string;
    expect(message).toContain('Night Update');
    expect(message).toContain(`<@user-${id}>`);
    expect(message).toContain('Sold 300 silk for 600 coin.');
  });

  it('logs a warning when a selling army has no channel', async () => {
    const id = seedArmy(db); // discord_channel_id stays null
    const sales = new Map([[id, ['Sold 300 silk for 600 coin.']]]);
    const log: string[] = [];
    const mockClient = { channels: { fetch: vi.fn() } };

    await postSellNotifications(db, sales, mockClient as never, log);

    expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    expect(log.some((l) => l.includes('no army channel'))).toBe(true);
  });

  it('logs a warning when the channel send fails', async () => {
    const id = seedArmy(db);
    setChannel(db, id, 'ch-army');
    const sales = new Map([[id, ['Sold 300 silk for 600 coin.']]]);
    const log: string[] = [];
    const mockClient = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error('Missing Access')) },
    };

    await postSellNotifications(db, sales, mockClient as never, log);

    expect(log.some((l) => l.includes('Missing Access'))).toBe(true);
  });
});

// ── postMovedArmyMaps ─────────────────────────────────────────────────────────

describe('postMovedArmyMaps', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 1, 0);
  });

  function flagMoved(db: Database.Database, armyId: number) {
    db.prepare('UPDATE armies SET moved_since_morning = 1 WHERE id = ?').run(armyId);
  }

  function setChannel(db: Database.Database, commanderId: number, channelId: string | null) {
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run(
      channelId,
      commanderId,
    );
  }

  it('posts a map to each flagged army channel and clears the flag', async () => {
    const id = seedArmy(db, { name: 'Iron Legion' });
    setChannel(db, id, 'ch-army');
    flagMoved(db, id);
    const stats = new Map([[id, makeStats({ hex_q: 0, hex_r: 1 })]]);

    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ isTextBased: () => true, send });
    const mockClient = { channels: { fetch } };

    await postMovedArmyMaps(db, stats, mockClient as never, []);

    expect(fetch).toHaveBeenCalledWith('ch-army');
    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0] as { content: string; files: unknown[] };
    expect(payload.content).toContain('Iron Legion');
    expect(payload.files).toHaveLength(1);

    const flag = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(id) as { moved_since_morning: number };
    expect(flag.moved_since_morning).toBe(0);
  });

  it('ignores armies that have not moved', async () => {
    const id = seedArmy(db);
    setChannel(db, id, 'ch-army');
    const stats = new Map([[id, makeStats()]]);

    const mockClient = { channels: { fetch: vi.fn() } };

    await postMovedArmyMaps(db, stats, mockClient as never, []);

    expect(mockClient.channels.fetch).not.toHaveBeenCalled();
  });

  it('warns and clears the flag when the army has no channel', async () => {
    const id = seedArmy(db); // no channel
    flagMoved(db, id);
    const stats = new Map([[id, makeStats()]]);
    const log: string[] = [];
    const mockClient = { channels: { fetch: vi.fn() } };

    await postMovedArmyMaps(db, stats, mockClient as never, log);

    expect(log.some((l) => l.includes('no army channel'))).toBe(true);
    const flag = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(id) as { moved_since_morning: number };
    expect(flag.moved_since_morning).toBe(0);
  });

  it('warns and keeps the flag when the send fails, to retry next morning', async () => {
    const id = seedArmy(db);
    setChannel(db, id, 'ch-army');
    flagMoved(db, id);
    const stats = new Map([[id, makeStats()]]);
    const log: string[] = [];
    const mockClient = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error('Missing Access')) },
    };

    await postMovedArmyMaps(db, stats, mockClient as never, log);

    expect(log.some((l) => l.includes('Missing Access'))).toBe(true);
    const flag = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(id) as { moved_since_morning: number };
    expect(flag.moved_since_morning).toBe(1);
  });

  it('keeps the flag when the army has no stats this tick', async () => {
    const id = seedArmy(db);
    setChannel(db, id, 'ch-army');
    flagMoved(db, id);
    const log: string[] = [];
    const mockClient = { channels: { fetch: vi.fn() } };

    await postMovedArmyMaps(db, new Map(), mockClient as never, log);

    expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    const flag = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(id) as { moved_since_morning: number };
    expect(flag.moved_since_morning).toBe(1);
  });
});

// ── consumeSupplies ───────────────────────────────────────────────────────────

describe('consumeSupplies', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('deducts daily supply consumption', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })], noncombatants: 0, supplies: 5000 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.supplies).toBe(4000); // 1000 infantry × 1/day
  });

  it('does not reduce supplies below 0', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 100 })], supplies: 50 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.supplies).toBe(0);
  });

  it('reduces morale by 1 when army cannot pay', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 100 })], supplies: 50, morale: 9 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.morale).toBe(8);
  });

  it('does not reduce morale when army has enough supplies', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 100 })], supplies: 10000, morale: 9 })]]);
    consumeSupplies(db, stats, []);
    expect(stats.get(id)!.morale).toBe(9);
  });

  it('does not reduce morale below 1', () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 100 })], supplies: 0, morale: 1 })]]);
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
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [], supplies: 0, scouting_range: 1 })]]);
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
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [], supplies: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 5 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    expect(stats.get(armyId)!.supplies).toBe(0);
  });

  it('skips armies in the moving set', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [], supplies: 0 })]]);
    seedHex(db, 0, 0, { settlement: 100 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set([armyId]));

    expect(stats.get(armyId)!.supplies).toBe(0);
  });

  it('extends range to 2 hexes when scouting_range is 2', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [], supplies: 0, scouting_range: 2 })]]);
    seedHex(db, 0, 0, { settlement: 10 }); // range 0
    seedHex(db, 0, 2, { settlement: 10 }); // range 2 (NW twice)
    seedHex(db, 2, -2, { settlement: 10 }); // range 2
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    // Must forage more than just the center hex
    expect(stats.get(armyId)!.supplies).toBeGreaterThan(10 * 500);
  });

  it('increments forage_count on each foraged hex', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [] })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 0 });
    seedOrder(db, armyId, 'forage');

    processForage(db, stats, [], new Set());

    const hex = db.prepare('SELECT forage_count FROM hexes WHERE q = 0 AND r = 0').get() as {
      forage_count: number;
    };
    expect(hex.forage_count).toBe(1);
  });

  it('logs revolt risk when any foraged hex has been foraged before', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [] })]]);
    seedHex(db, 0, 0, { settlement: 100, forage_count: 1 });
    seedOrder(db, armyId, 'forage');

    const log: string[] = [];
    processForage(db, stats, log, new Set());

    expect(log.some((l) => l.toLowerCase().includes('revolt'))).toBe(true);
  });

  it('does not log revolt risk when all foraged hexes are fresh', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats({ infantry_detachments: [] })]]);
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
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });

    const moved = processMovement(db, stats, []);
    expect(moved.has(armyId)).toBe(true);

    expect(stats.get(armyId)!.hex_q).toBe(0);
    expect(stats.get(armyId)!.hex_r).toBe(1);

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).not.toBeNull();
  });

  it('flags moved armies for the morning map render', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });

    processMovement(db, stats, []);

    const row = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(armyId) as { moved_since_morning: number };
    expect(row.moved_since_morning).toBe(1);
  });

  it('does not flag armies that could not move', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedOrder(db, armyId, 'move', { dest_q: 9, dest_r: 9, roads_only: false }); // no path

    processMovement(db, stats, []);

    const row = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(armyId) as { moved_since_morning: number };
    expect(row.moved_since_morning).toBe(0);
  });

  it('advances 1 hex per tick off-road, leaving order pending', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: false });

    processMovement(db, stats, []);

    expect(stats.get(armyId)!.hex_r).toBe(1); // 1 hex off-road

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).toBeNull();
  });

  it('advances 2 hexes per tick on road', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: true });

    processMovement(db, stats, []);

    expect(stats.get(armyId)!.hex_r).toBe(2); // 2 hexes on road
  });

  it('cannot path through a speed=0 hex', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);                    // passable
    seedHex(db, 0, 1, { speed: 0 });      // impassable — only route to (0,2)
    seedHex(db, 0, 2);                    // passable but unreachable
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 2, roads_only: false });

    const log: string[] = [];
    processMovement(db, stats, log);

    expect(stats.get(armyId)!.hex_q).toBe(0);
    expect(stats.get(armyId)!.hex_r).toBe(0);
    expect(log.some((l) => l.includes('no valid path'))).toBe(true);
  });

  it('off-road movement distance is determined by current hex speed', () => {
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0, { speed: 12 }); // double speed — should move 2 hexes off-road
    seedHex(db, 0, 1, { speed: 12 });
    seedHex(db, 0, 2, { speed: 12 });
    seedHex(db, 0, 3, { speed: 12 });
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: false });

    processMovement(db, stats, []);

    expect(stats.get(armyId)!.hex_r).toBe(2);
  });

  it('cancels order and logs warning when no valid path exists', () => {
    const armyId = seedArmy(db);
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
    const armyId = seedArmy(db);
    const stats = new Map([[armyId, makeStats()]]);
    seedHex(db, 0, 0);
    seedOrder(db, armyId, 'move', { dest_q: 9, dest_r: 9, roads_only: false });

    const moved = processMovement(db, stats, []);
    expect(moved.has(armyId)).toBe(false);
  });

  it('stops a moving army when it enters a hex with an engaging enemy', () => {
    // Army A (faction 1) moving from (0,0) to (0,2); Army B (faction 2) is at (0,1) in engage stance
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(1, 'Red', 'r1');
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(2, 'Blue', 'r2');
    const aId = seedArmy(db, { faction_id: 1 });
    const bId = seedArmy(db, { faction_id: 2 });
    seedHex(db, 0, 0, { speed: 12 }); // speed 12 → 2 hexes/tick off-road, so A would reach (0,2)
    seedHex(db, 0, 1, { speed: 12 });
    seedHex(db, 0, 2, { speed: 12 });
    seedOrder(db, aId, 'move', { dest_q: 0, dest_r: 2, roads_only: false });
    const stats = new Map([
      [aId, makeStats({ hex_q: 0, hex_r: 0 })],
      [bId, makeStats({ stance: 'engage', hex_q: 0, hex_r: 1 })],
    ]);

    processMovement(db, stats, []);

    expect(stats.get(aId)!.hex_r).toBe(1); // stopped at (0,1), not (0,2)
  });

  it('does not stop a moving army when the occupying army is in allow_passage stance', () => {
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(1, 'Red', 'r1');
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(2, 'Blue', 'r2');
    const aId = seedArmy(db, { faction_id: 1 });
    const bId = seedArmy(db, { faction_id: 2 });
    seedHex(db, 0, 0, { speed: 12 });
    seedHex(db, 0, 1, { speed: 12 });
    seedHex(db, 0, 2, { speed: 12 });
    seedOrder(db, aId, 'move', { dest_q: 0, dest_r: 2, roads_only: false });
    const stats = new Map([
      [aId, makeStats({ hex_q: 0, hex_r: 0 })],
      [bId, makeStats({ stance: 'allow_passage', hex_q: 0, hex_r: 1 })],
    ]);

    processMovement(db, stats, []);

    expect(stats.get(aId)!.hex_r).toBe(2); // passed through to destination
  });

  it('does not stop a moving army when the engaging army is the same faction', () => {
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(1, 'Red', 'r1');
    const aId = seedArmy(db, { faction_id: 1 });
    const bId = seedArmy(db, { faction_id: 1 });
    seedHex(db, 0, 0, { speed: 12 });
    seedHex(db, 0, 1, { speed: 12 });
    seedHex(db, 0, 2, { speed: 12 });
    seedOrder(db, aId, 'move', { dest_q: 0, dest_r: 2, roads_only: false });
    const stats = new Map([
      [aId, makeStats({ hex_q: 0, hex_r: 0 })],
      [bId, makeStats({ stance: 'engage', hex_q: 0, hex_r: 1 })],
    ]);

    processMovement(db, stats, []);

    expect(stats.get(aId)!.hex_r).toBe(2); // ally — not blocked
  });

  it('logs an engage notification when enemy armies with engage stance share a hex', () => {
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(1, 'Red', 'r1');
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(2, 'Blue', 'r2');
    const aId = seedArmy(db, { faction_id: 1, name: 'Iron Legion' });
    const bId = seedArmy(db, { faction_id: 2, name: 'Black Company' });
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, aId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });
    const stats = new Map([
      [aId, makeStats({ hex_q: 0, hex_r: 0 })],
      [bId, makeStats({ stance: 'engage', hex_q: 0, hex_r: 1 })],
    ]);

    const log: string[] = [];
    processMovement(db, stats, log);

    expect(log.some((l) => l.includes('engage') || l.includes('Engage') || l.includes('ENGAGE'))).toBe(true);
    expect(log.some((l) => l.includes('Black Company'))).toBe(true);
  });

  it('does not log a collision when all armies in a hex are allow_passage', () => {
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(1, 'Red', 'r1');
    db.prepare('INSERT INTO factions (id, name, discord_role_id) VALUES (?, ?, ?)').run(2, 'Blue', 'r2');
    const aId = seedArmy(db, { faction_id: 1 });
    const bId = seedArmy(db, { faction_id: 2 });
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, aId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });
    const stats = new Map([
      [aId, makeStats({ hex_q: 0, hex_r: 0 })],
      [bId, makeStats({ stance: 'allow_passage', hex_q: 0, hex_r: 1 })],
    ]);

    const log: string[] = [];
    processMovement(db, stats, log);

    expect(log.some((l) => l.includes('⚔️'))).toBe(false);
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

  it('includes the error detail in the log when delivery fails', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    insertMessage(db, past);

    const log: string[] = [];
    const mockClient = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error('Missing Access')) },
    };

    await deliverMessages(db, mockClient as never, log);

    expect(log.some((l) => l.includes('Missing Access'))).toBe(true);
    // Not marked delivered — will retry next tick
    const msg = db.prepare('SELECT delivered FROM messages').get() as { delivered: number };
    expect(msg.delivered).toBe(0);
  });
});

// ── formatTickDuration ────────────────────────────────────────────────────────

describe('formatTickDuration', () => {
  it('rounds to the nearest second', () => {
    expect(formatTickDuration(3400)).toBe('3s');
    expect(formatTickDuration(3600)).toBe('4s');
  });

  it('shows sub-second durations as <1s', () => {
    expect(formatTickDuration(0)).toBe('<1s');
    expect(formatTickDuration(400)).toBe('<1s');
  });

  it('breaks out minutes for long ticks', () => {
    expect(formatTickDuration(95000)).toBe('1m 35s');
    expect(formatTickDuration(120000)).toBe('2m 0s');
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
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })], supplies: 5000 })]]);
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
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })], supplies: 5000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-1', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    expect(getEmbed(send).color).toBe(0xe67e22); // orange: 4–7 days
  });

  it('skips armies with no discord_channel_id', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })], supplies: 5000 })]]);

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
    const stats = new Map([[id, makeStats({ cavalry_detachments: [det({ size: 100 })], infantry_detachments: [], supplies: 10000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ?, army_sheet_url = ? WHERE id = ?')
      .run('ch-2', 'https://docs.google.com/spreadsheets/d/abc', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    expect(getEmbed(send).url).toBe('https://docs.google.com/spreadsheets/d/abc');
  });

  it('shows zero date in description when consumption > 0', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })], supplies: 3000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-3', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date('2026-07-16T06:00:00Z'));

    const desc = getEmbed(send).description ?? '';
    expect(desc).toContain('Zero Date');
    expect(desc).toContain('July 19'); // 3000/1000 = 3 days out
  });

  it('omits zero date and shows ∞ when consumption is zero', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [], supplies: 1000 })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('ch-4', id);

    const send = vi.fn().mockResolvedValue(undefined);
    await postSupplyUpdates(db, stats, makeClient(send) as never, [], new Date());

    const desc = getEmbed(send).description ?? '';
    expect(desc).toContain('∞');
    expect(desc).not.toContain('Zero Date');
  });

  it('logs a warning when channel fetch fails', async () => {
    const id = seedArmy(db);
    const stats = new Map([[id, makeStats({ infantry_detachments: [det({ size: 1000 })] })]]);
    db.prepare('UPDATE commanders SET discord_channel_id = ? WHERE id = ?').run('bad-ch', id);

    const log: string[] = [];
    const badClient = {
      channels: { fetch: vi.fn().mockRejectedValue(new Error('unknown channel')) },
    };
    await postSupplyUpdates(db, stats, badClient as never, log, new Date());
    expect(log.some((l) => l.includes('supply update'))).toBe(true);
  });
});

// ── processNightMarchMovement ─────────────────────────────────────────────────

describe('processNightMarchMovement', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
    seedHex(db, 0, 0);
    seedHex(db, 1, 0);
    seedHex(db, 2, 0);
    // Alternating rolls: never doubles, so morale checks stay quiet unless a test overrides
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (i++ % 2 === 0 ? 0.1 : 0.9));
  });

  afterEach(() => vi.restoreAllMocks());

  it('moves a night-marching army 1 hex toward its destination', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'move', { dest_q: 2, dest_r: 0, roads_only: true });
    const stats = new Map([[id, makeStats({ night_march: true })]]);

    processNightMarchMovement(db, stats, []);

    expect(stats.get(id)!.hex_q).toBe(1);
    const flag = db
      .prepare('SELECT moved_since_morning FROM armies WHERE id = ?')
      .get(id) as { moved_since_morning: number };
    expect(flag.moved_since_morning).toBe(1);
    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(id) as {
      processed_at: string | null;
    };
    expect(order.processed_at).toBeNull(); // not yet arrived
  });

  it('moves 2 hexes when also forced marching', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'move', { dest_q: 2, dest_r: 0, roads_only: true });
    const stats = new Map([[id, makeStats({ night_march: true, forced_march: true })]]);

    processNightMarchMovement(db, stats, []);

    expect(stats.get(id)!.hex_q).toBe(2);
    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(id) as {
      processed_at: string | null;
    };
    expect(order.processed_at).not.toBeNull(); // arrived
  });

  it('skips armies that are not night marching', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'move', { dest_q: 2, dest_r: 0, roads_only: true });
    const stats = new Map([[id, makeStats({ night_march: false })]]);

    processNightMarchMovement(db, stats, []);

    expect(stats.get(id)!.hex_q).toBe(0);
  });

  it('warns and holds when the order is off-road', () => {
    const id = seedArmy(db);
    seedOrder(db, id, 'move', { dest_q: 2, dest_r: 0, roads_only: false });
    const stats = new Map([[id, makeStats({ night_march: true })]]);
    const log: string[] = [];

    processNightMarchMovement(db, stats, log);

    expect(stats.get(id)!.hex_q).toBe(0);
    expect(log.some((l) => l.includes('off-road'))).toBe(true);
  });

  it('applies the night march morale check on doubles', () => {
    vi.mocked(Math.random).mockReturnValue(0.99); // both dice roll 6
    const id = seedArmy(db);
    seedOrder(db, id, 'move', { dest_q: 2, dest_r: 0, roads_only: true });
    const stats = new Map([[id, makeStats({ night_march: true, morale: 9 })]]);
    const log: string[] = [];

    processNightMarchMovement(db, stats, log);

    expect(stats.get(id)!.morale).toBe(8);
    expect(log.some((l) => l.includes('night march'))).toBe(true);
  });
});

// ── rollMarchMorale ───────────────────────────────────────────────────────────

describe('rollMarchMorale', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loses 1 morale on doubles', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // both dice roll 6
    const stats = new Map([[1, makeStats({ morale: 9 })]]);
    const log: string[] = [];

    rollMarchMorale(stats, 1, 'Legion', 'forced', log);

    expect(stats.get(1)!.morale).toBe(8);
    expect(log.some((l) => l.includes('lost 1 morale'))).toBe(true);
  });

  it('does nothing when the dice differ', () => {
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (i++ % 2 === 0 ? 0.1 : 0.9));
    const stats = new Map([[1, makeStats({ morale: 9 })]]);
    const log: string[] = [];

    rollMarchMorale(stats, 1, 'Legion', 'night', log);

    expect(stats.get(1)!.morale).toBe(9);
    expect(log).toHaveLength(0);
  });

  it('does not drop morale below 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const stats = new Map([[1, makeStats({ morale: 1 })]]);

    rollMarchMorale(stats, 1, 'Legion', 'forced', []);

    expect(stats.get(1)!.morale).toBe(1);
  });

  it('rolls faces 1-6 — never 0 — when the RNG bottoms out', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const stats = new Map([[1, makeStats({ morale: 9 })]]);
    const log: string[] = [];

    rollMarchMorale(stats, 1, 'Legion', 'night', log);

    expect(stats.get(1)!.morale).toBe(8); // 1,1 is doubles
    expect(log[0]).toContain('rolled 1,1');
  });
});

// ── malformed order parameters ────────────────────────────────────────────────

describe('malformed order parameters', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  function seedMalformedOrder(db: Database.Database, armyId: number): void {
    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'move', 'not-json{')").run(
      armyId,
    );
  }

  it('processMovement cancels a malformed order and still moves other armies', () => {
    seedHex(db, 0, 0);
    seedHex(db, 1, 0);
    const bad = seedArmy(db);
    const good = seedArmy(db);
    seedMalformedOrder(db, bad);
    seedOrder(db, good, 'move', { dest_q: 1, dest_r: 0, roads_only: false });
    const stats = new Map([
      [bad, makeStats()],
      [good, makeStats()],
    ]);
    const log: string[] = [];

    const moved = processMovement(db, stats, log);

    expect(moved.has(good)).toBe(true);
    expect(stats.get(good)!.hex_q).toBe(1);
    const row = db
      .prepare('SELECT processed_at FROM orders WHERE army_id = ?')
      .get(bad) as { processed_at: string | null };
    expect(row.processed_at).not.toBeNull();
    expect(log.some((l) => l.includes('malformed'))).toBe(true);
  });

  it('processNightMarchMovement cancels a malformed order and still moves other armies', () => {
    seedHex(db, 0, 0);
    seedHex(db, 1, 0);
    const bad = seedArmy(db);
    const good = seedArmy(db);
    seedMalformedOrder(db, bad);
    seedOrder(db, good, 'move', { dest_q: 1, dest_r: 0, roads_only: true });
    const stats = new Map([
      [bad, makeStats({ night_march: true })],
      [good, makeStats({ night_march: true })],
    ]);
    const log: string[] = [];

    processNightMarchMovement(db, stats, log);

    expect(stats.get(good)!.hex_q).toBe(1);
    const row = db
      .prepare('SELECT processed_at FROM orders WHERE army_id = ?')
      .get(bad) as { processed_at: string | null };
    expect(row.processed_at).not.toBeNull();
    expect(log.some((l) => l.includes('malformed'))).toBe(true);
  });
});
