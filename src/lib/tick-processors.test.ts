import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import {
  consumeSupplies,
  deliverMessages,
  processForage,
  processMovement,
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
    infantry?: number;
    cavalry?: number;
    wagons?: number;
    noncombatants?: number;
    morale?: number;
    supplies?: number;
    forced_march?: number;
    night_march?: number;
  } = {},
): number {
  const id = overrides.id ?? ++seq;
  db.prepare('INSERT INTO commanders (id, discord_user_id) VALUES (?, ?)').run(
    id,
    `user-${id}`,
  );
  db.prepare(
    `INSERT INTO armies
      (id, commander_id, name, hex_q, hex_r, infantry, cavalry, wagons,
       noncombatants, morale, supplies, forced_march, night_march)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    overrides.name ?? `Army ${id}`,
    overrides.hex_q ?? 0,
    overrides.hex_r ?? 0,
    overrides.infantry ?? 1000,
    overrides.cavalry ?? 0,
    overrides.wagons ?? 0,
    overrides.noncombatants ?? 0,
    overrides.morale ?? 9,
    overrides.supplies ?? 10000,
    overrides.forced_march ?? 0,
    overrides.night_march ?? 0,
  );
  return id;
}

function seedHex(
  db: Database.Database,
  q: number,
  r: number,
  overrides: { settlement?: number; forage_count?: number; terrain?: string } = {},
): void {
  db.prepare(
    'INSERT OR IGNORE INTO hexes (q, r, terrain, settlement, roads, rivers, forage_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    q,
    r,
    overrides.terrain ?? 'flatland',
    overrides.settlement ?? 100,
    '[]',
    '[]',
    overrides.forage_count ?? 0,
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
    seedArmy(db, { infantry: 1000, cavalry: 0, noncombatants: 0, supplies: 5000 });
    consumeSupplies(db, []);
    const army = db.prepare('SELECT * FROM armies WHERE id = 1').get() as { supplies: number };
    expect(army.supplies).toBe(4000); // 1000 infantry × 1/day
  });

  it('does not reduce supplies below 0', () => {
    seedArmy(db, { infantry: 100, supplies: 50 });
    consumeSupplies(db, []);
    const army = db.prepare('SELECT * FROM armies WHERE id = 1').get() as { supplies: number };
    expect(army.supplies).toBe(0);
  });

  it('reduces morale by 1 when army cannot pay', () => {
    seedArmy(db, { infantry: 100, supplies: 50, morale: 9 });
    consumeSupplies(db, []);
    const army = db.prepare('SELECT * FROM armies WHERE id = 1').get() as { morale: number };
    expect(army.morale).toBe(8);
  });

  it('does not reduce morale when army has enough supplies', () => {
    seedArmy(db, { infantry: 100, supplies: 10000, morale: 9 });
    consumeSupplies(db, []);
    const army = db.prepare('SELECT * FROM armies WHERE id = 1').get() as { morale: number };
    expect(army.morale).toBe(9);
  });

  it('does not reduce morale below 1', () => {
    seedArmy(db, { infantry: 100, supplies: 0, morale: 1 });
    consumeSupplies(db, []);
    const army = db.prepare('SELECT * FROM armies WHERE id = 1').get() as { morale: number };
    expect(army.morale).toBe(1);
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
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0, supplies: 0, infantry: 0 });
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

    processForage(db, [], new Set());

    const army = db.prepare('SELECT supplies FROM armies WHERE id = ?').get(armyId) as {
      supplies: number;
    };
    expect(army.supplies).toBe(7 * 10 * 500); // 35,000
  });

  it('skips exhausted hexes', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0, supplies: 0, infantry: 0 });
    seedHex(db, 0, 0, { settlement: 100, forage_count: 5 });
    seedOrder(db, armyId, 'forage');

    processForage(db, [], new Set());

    const army = db.prepare('SELECT supplies FROM armies WHERE id = ?').get(armyId) as {
      supplies: number;
    };
    expect(army.supplies).toBe(0);
  });

  it('skips armies in the moving set', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0, supplies: 0, infantry: 0 });
    seedHex(db, 0, 0, { settlement: 100 });
    seedOrder(db, armyId, 'forage');

    processForage(db, [], new Set([armyId]));

    const army = db.prepare('SELECT supplies FROM armies WHERE id = ?').get(armyId) as {
      supplies: number;
    };
    expect(army.supplies).toBe(0);
  });

  it('extends range to 2 hexes for cavalry armies', () => {
    const armyId = seedArmy(db, {
      hex_q: 0,
      hex_r: 0,
      cavalry: 200,
      infantry: 0,
      supplies: 0,
    });
    seedHex(db, 0, 0, { settlement: 10 }); // range 0
    seedHex(db, 0, 2, { settlement: 10 }); // range 2 (NW twice)
    seedHex(db, 2, -2, { settlement: 10 }); // range 2
    seedOrder(db, armyId, 'forage');

    processForage(db, [], new Set());

    const army = db.prepare('SELECT supplies FROM armies WHERE id = ?').get(armyId) as {
      supplies: number;
    };
    // Must forage more than just the center hex
    expect(army.supplies).toBeGreaterThan(10 * 500);
  });

  it('increments forage_count on each foraged hex', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0, infantry: 0 });
    seedHex(db, 0, 0, { settlement: 100, forage_count: 0 });
    seedOrder(db, armyId, 'forage');

    processForage(db, [], new Set());

    const hex = db.prepare('SELECT forage_count FROM hexes WHERE q = 0 AND r = 0').get() as {
      forage_count: number;
    };
    expect(hex.forage_count).toBe(1);
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
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 1, roads_only: false });

    processMovement(db, []);

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
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: false });

    processMovement(db, []);

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
    seedHex(db, 0, 0);
    seedHex(db, 0, 1);
    seedHex(db, 0, 2);
    seedHex(db, 0, 3);
    seedOrder(db, armyId, 'move', { dest_q: 0, dest_r: 3, roads_only: true });

    processMovement(db, []);

    const army = db.prepare('SELECT hex_r FROM armies WHERE id = ?').get(armyId) as {
      hex_r: number;
    };
    expect(army.hex_r).toBe(2); // 2 hexes on road
  });

  it('cancels order and logs warning when no valid path exists', () => {
    const armyId = seedArmy(db, { hex_q: 0, hex_r: 0 });
    seedHex(db, 0, 0);
    seedOrder(db, armyId, 'move', { dest_q: 9, dest_r: 9, roads_only: false });

    const log: string[] = [];
    processMovement(db, log);

    const order = db.prepare('SELECT processed_at FROM orders WHERE army_id = ?').get(armyId) as {
      processed_at: string | null;
    };
    expect(order.processed_at).not.toBeNull();
    expect(log.some((l) => l.includes('no valid path'))).toBe(true);
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
