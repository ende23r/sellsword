import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { armyInitials, armyRingOffsets, getArmiesForMap, getPlayerMapHexes, trianglePoints } from './map-render.js';
import type { HexRow } from './db.js';

function makeHex(q: number, r: number): HexRow {
  return { id: q * 1000 + r, q, r, terrain: 'flatland', settlement: 0, roads: '[]', rivers: '[]', forage_count: 0, last_foraged: null, speed: 6 };
}

describe('armyInitials', () => {
  it('takes first letter of alpha words and leading digits of numeric words', () => {
    expect(armyInitials('Orange 1st')).toBe('O1');
  });

  it('takes initials of multi-word alpha names', () => {
    expect(armyInitials('Iron Legion')).toBe('IL');
  });

  it('handles a numeric leading word', () => {
    expect(armyInitials('2nd Army')).toBe('2A');
  });

  it('caps at 3 chars', () => {
    expect(armyInitials('Alpha Beta Gamma Delta')).toBe('ABG');
  });

  it('returns ? for null name', () => {
    expect(armyInitials(null)).toBe('?');
  });

  it('returns ? for empty string', () => {
    expect(armyInitials('')).toBe('?');
  });
});

describe('getArmiesForMap', () => {
  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(DB_SCHEMA);
    return db;
  }

  it('returns empty array when no armies', () => {
    const db = makeDb();
    expect(getArmiesForMap(db, new Map())).toEqual([]);
  });

  it('returns army position, name, and faction color', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO factions (name, discord_role_id, color) VALUES (?, ?, ?)`).run(
      'Orange',
      'role-1',
      '#ff8800',
    );
    const factionId = (db.prepare(`SELECT id FROM factions WHERE discord_role_id = 'role-1'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO commanders (discord_user_id, faction_id) VALUES (?, ?)`).run(
      'user-1',
      factionId,
    );
    const commanderId = (db.prepare(`SELECT id FROM commanders WHERE discord_user_id = 'user-1'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO armies (commander_id, name) VALUES (?, ?)`).run(commanderId, 'Orange 1st');
    const armyId = (db.prepare(`SELECT id FROM armies WHERE commander_id = ?`).get(commanderId) as { id: number }).id;

    const statsMap = new Map([[armyId, { hex_q: 3, hex_r: 5 }]]);
    const result = getArmiesForMap(db, statsMap);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hex_q: 3,
      hex_r: 5,
      name: 'Orange 1st',
      faction_color: '#ff8800',
    });
  });

  it('returns null faction_color when commander has no faction', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO commanders (discord_user_id) VALUES (?)`).run('user-2');
    const commanderId = (db.prepare(`SELECT id FROM commanders WHERE discord_user_id = 'user-2'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO armies (commander_id, name) VALUES (?, ?)`).run(commanderId, 'Solo Army');
    const armyId = (db.prepare(`SELECT id FROM armies WHERE commander_id = ?`).get(commanderId) as { id: number }).id;

    const statsMap = new Map([[armyId, { hex_q: 1, hex_r: 2 }]]);
    const result = getArmiesForMap(db, statsMap);
    expect(result).toHaveLength(1);
    expect(result[0].faction_color).toBeNull();
  });

  it('excludes armies with no stats entry (position unknown)', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO commanders (discord_user_id) VALUES (?)`).run('user-3');
    const commanderId = (db.prepare(`SELECT id FROM commanders WHERE discord_user_id = 'user-3'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO armies (commander_id, name) VALUES (?, ?)`).run(commanderId, 'Ghost Army');

    const result = getArmiesForMap(db, new Map());
    expect(result).toHaveLength(0);
  });
});

describe('getPlayerMapHexes', () => {
  it('returns only hexes within scoutRange + 1 fog ring', () => {
    // 37 hexes at range 3 from center; scoutRange=1 should give back range-2 = 19
    const allHexes = Array.from({ length: 7 }, (_, i) => i - 3).flatMap((q) =>
      Array.from({ length: 7 }, (_, j) => j - 3).map((r) => makeHex(q, r)),
    );
    const { hexes } = getPlayerMapHexes(allHexes, { q: 0, r: 0 }, 1);
    // range 2 has 1+6+12 = 19 hexes
    expect(hexes.length).toBe(19);
  });

  it('excludes hexes beyond the fog ring', () => {
    const allHexes = Array.from({ length: 7 }, (_, i) => i - 3).flatMap((q) =>
      Array.from({ length: 7 }, (_, j) => j - 3).map((r) => makeHex(q, r)),
    );
    const { hexes } = getPlayerMapHexes(allHexes, { q: 0, r: 0 }, 1);
    expect(hexes.every((h: HexRow) => Math.abs(h.q) <= 2 && Math.abs(h.r) <= 2)).toBe(true);
  });

  it('visibleCoords contains exactly the hexes within scoutRange', () => {
    const allHexes = Array.from({ length: 7 }, (_, i) => i - 3).flatMap((q) =>
      Array.from({ length: 7 }, (_, j) => j - 3).map((r) => makeHex(q, r)),
    );
    const { visibleCoords } = getPlayerMapHexes(allHexes, { q: 0, r: 0 }, 1);
    // range 1 has 7 hexes
    expect(visibleCoords.size).toBe(7);
    expect(visibleCoords.has('0,0')).toBe(true);
    expect(visibleCoords.has('1,0')).toBe(true);
  });

  it('fog ring hexes are in returned hexes but not in visibleCoords', () => {
    const allHexes = Array.from({ length: 7 }, (_, i) => i - 3).flatMap((q) =>
      Array.from({ length: 7 }, (_, j) => j - 3).map((r) => makeHex(q, r)),
    );
    const { hexes, visibleCoords } = getPlayerMapHexes(allHexes, { q: 0, r: 0 }, 1);
    const fogOnly = hexes.filter((h: HexRow) => !visibleCoords.has(`${h.q},${h.r}`));
    expect(fogOnly.length).toBe(12); // ring 2 has 12 hexes
  });

  it('does not add phantom hexes that do not exist in allHexes', () => {
    // Only 7 hexes in range 1; fog ring at range 2 doesn't exist in DB
    const allHexes = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
      { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }].map(({ q, r }) => makeHex(q, r));
    const { hexes } = getPlayerMapHexes(allHexes, { q: 0, r: 0 }, 1);
    expect(hexes.length).toBe(7); // fog ring hexes don't exist, so nothing added
  });
});

describe('armyRingOffsets', () => {
  it('returns a single [0,0] offset for one army', () => {
    const offsets = armyRingOffsets(1, 20);
    expect(offsets).toHaveLength(1);
    expect(offsets[0][0]).toBeCloseTo(0);
    expect(offsets[0][1]).toBeCloseTo(0);
  });

  it('returns N offsets for N armies', () => {
    expect(armyRingOffsets(4, 20)).toHaveLength(4);
  });

  it('all offsets for count > 1 lie exactly on the ring radius', () => {
    const r = 20;
    for (const [dx, dy] of armyRingOffsets(3, r)) {
      expect(Math.hypot(dx, dy)).toBeCloseTo(r);
    }
  });

  it('first offset points straight up (negative y) for count > 1', () => {
    const [[dx, dy]] = armyRingOffsets(2, 20);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(-20);
  });

  it('two armies are positioned opposite each other', () => {
    const [[dx0, dy0], [dx1, dy1]] = armyRingOffsets(2, 20);
    expect(dx0 + dx1).toBeCloseTo(0);
    expect(dy0 + dy1).toBeCloseTo(0);
  });
});

describe('trianglePoints', () => {
  it('produces exactly 3 point pairs', () => {
    const pts = trianglePoints(0, 0, 10);
    expect(pts.trim().split(' ')).toHaveLength(3);
  });

  it('all points lie on the circumradius', () => {
    const r = 10;
    const pts = trianglePoints(5, 5, r);
    for (const pair of pts.trim().split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      const dist = Math.hypot(x - 5, y - 5);
      expect(dist).toBeCloseTo(r, 0);
    }
  });

  it('top vertex is at the minimum y (triangle points up)', () => {
    const pts = trianglePoints(0, 0, 10);
    const ys = pts.trim().split(' ').map((p: string) => Number(p.split(',')[1]));
    const minY = Math.min(...ys);
    // top vertex is at angle -90°, so y = -r ≈ -10
    expect(minY).toBeCloseTo(-10, 0);
  });
});
