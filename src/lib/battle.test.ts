import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { effectiveStrength, numericalAdvantage, resolveBattle } from './battle.js';

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
    hex_q?: number;
    hex_r?: number;
    infantry?: number;
    infantry_strength?: number;
    cavalry?: number;
    cavalry_strength?: number;
    noncombatants?: number;
    scouting_range?: number;
    morale?: number;
    max_morale?: number;
    supplies?: number;
  } = {},
): number {
  const id = overrides.id ?? ++seq;
  db.prepare('INSERT INTO commanders (id, discord_user_id) VALUES (?, ?)').run(id, `user-${id}`);
  db.prepare(
    `INSERT INTO armies (id, commander_id, hex_q, hex_r, infantry, infantry_strength, cavalry, cavalry_strength, noncombatants, scouting_range, morale, max_morale, supplies)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    overrides.hex_q ?? 0,
    overrides.hex_r ?? 0,
    overrides.infantry ?? 1000,
    overrides.infantry_strength ?? 0,
    overrides.cavalry ?? 0,
    overrides.cavalry_strength ?? 0,
    overrides.noncombatants ?? 0,
    overrides.scouting_range ?? 1,
    overrides.morale ?? 9,
    overrides.max_morale ?? 12,
    overrides.supplies ?? 10000,
  );
  return id;
}

// Produce a deterministic rng from a sequence of values.
// Math.ceil(val * 6) gives the die face for each value.
function seqRng(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++] ?? 0.5;
}

describe('effectiveStrength', () => {
  it('sums infantry_strength + noncombatants + cavalry_strength', () => {
    expect(effectiveStrength({ infantry_strength: 1000, cavalry_strength: 400, noncombatants: 300 } as any)).toBe(1700);
  });

  it('excludes raw counts and wagons', () => {
    expect(effectiveStrength({ infantry_strength: 0, cavalry_strength: 0, noncombatants: 0 } as any)).toBe(0);
  });
});

describe('numericalAdvantage', () => {
  it('returns 0 for equal strength', () => expect(numericalAdvantage(1000, 1000)).toBe(0));
  it('returns 0 below 1.25×', () => expect(numericalAdvantage(1200, 1000)).toBe(0));
  it('returns 1 at exactly 1.25×', () => expect(numericalAdvantage(1250, 1000)).toBe(1));
  it('returns 2 at 1.5×', () => expect(numericalAdvantage(1500, 1000)).toBe(2));
  it('returns 3 at 2×', () => expect(numericalAdvantage(2000, 1000)).toBe(3));
  it('returns 4 at 3×', () => expect(numericalAdvantage(3000, 1000)).toBe(4));
  it('returns 5 at 4×', () => expect(numericalAdvantage(4000, 1000)).toBe(5));
  it('returns 6 at 5×', () => expect(numericalAdvantage(5000, 1000)).toBe(6));
  it('returns 7 at 6×', () => expect(numericalAdvantage(6000, 1000)).toBe(7));
  it('caps at 7 above 6×', () => expect(numericalAdvantage(10000, 1000)).toBe(7));
  it('returns 7 when weaker is 0', () => expect(numericalAdvantage(1000, 0)).toBe(7));
});

describe('resolveBattle', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seq = 0;
  });

  it('returns an error when army A is not found', () => {
    const result = resolveBattle(db, 99, 2, null);
    expect(result).toEqual({ error: expect.stringContaining('99') });
  });

  it('returns an error when army B is not found', () => {
    const a = seedArmy(db);
    const result = resolveBattle(db, a, 99, null);
    expect(result).toEqual({ error: expect.stringContaining('99') });
  });

  it('returns an error when armies are not in the same hex', () => {
    const a = seedArmy(db, { hex_q: 0, hex_r: 0 });
    const b = seedArmy(db, { hex_q: 1, hex_r: 0 });
    const result = resolveBattle(db, a, b, null);
    expect(result).toEqual({ error: expect.stringContaining('same hex') });
  });

  it('higher total wins', () => {
    // A rolls 12 (1,1 → ceil(1*6)=6 each), B rolls 2 (1/6,1/6 → ceil(1)=1 each)
    const a = seedArmy(db);
    const b = seedArmy(db);
    const result = resolveBattle(db, a, b, null, seqRng(1, 1, 1 / 6, 1 / 6)) as any;
    expect(result.winner).toBe('a');
    expect(result.sideA.roll).toBe(12);
    expect(result.sideB.roll).toBe(2);
  });

  it('tie with no attacker is a draw', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    // Both roll 6 (0.5 → ceil(3)=3, 3+3=6)
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.winner).toBe('draw');
  });

  it('tie with B attacking: A (defender) holds', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    // A defends (+1 mod). A rolls 5, B rolls 6 → totals 6 vs 6 → tie, A holds.
    const result = resolveBattle(db, a, b, b, seqRng(2 / 6, 3 / 6, 3 / 6, 3 / 6)) as any;
    expect(result.winner).toBe('a');
    expect(result.diff).toBe(0);
  });

  it('tie with A attacking: B (defender) holds', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    // B defends (+1 mod). A rolls 6, B rolls 5 → totals 6 vs 6 → tie, B holds.
    const result = resolveBattle(db, a, b, a, seqRng(3 / 6, 3 / 6, 2 / 6, 3 / 6)) as any;
    expect(result.winner).toBe('b');
    expect(result.diff).toBe(0);
  });

  it('diff=0 with attacker: attacker loses 1 morale, both take 5%', () => {
    // B attacks, A defends. A gets +1 (chosen battlefield). A rolls 5, B rolls 6 → totals tie.
    const a = seedArmy(db, { infantry: 1000, noncombatants: 0, cavalry: 0, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, noncombatants: 0, cavalry: 0, morale: 9 });
    resolveBattle(db, a, b, b, seqRng(2 / 6, 3 / 6, 3 / 6, 3 / 6));
    const updatedA = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(a) as any;
    const updatedB = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(b) as any;
    expect(updatedA.infantry).toBe(950); // 5% casualties
    expect(updatedA.morale).toBe(9);     // no morale change for defender
    expect(updatedB.infantry).toBe(950); // 5% casualties
    expect(updatedB.morale).toBe(8);     // -1 attacker penalty
  });

  it('draw: 5% casualties each, no morale change', () => {
    const a = seedArmy(db, { infantry: 1000, noncombatants: 0, cavalry: 0, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, noncombatants: 0, cavalry: 0, morale: 9 });
    resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5));
    const updatedA = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(a) as any;
    const updatedB = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(b) as any;
    expect(updatedA.infantry).toBe(950);
    expect(updatedB.infantry).toBe(950);
    expect(updatedA.morale).toBe(9);
    expect(updatedB.morale).toBe(9);
  });

  it('diff=1: both 10% casualties, loser −1 morale', () => {
    // A rolls 4+3=7, B rolls 3+3=6 → diff 1, A wins
    const a = seedArmy(db, { infantry: 1000, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    resolveBattle(db, a, b, null, seqRng(4 / 6, 3 / 6, 3 / 6, 3 / 6));
    const updatedA = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(a) as any;
    const updatedB = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(b) as any;
    expect(updatedA.infantry).toBe(900);
    expect(updatedB.infantry).toBe(900);
    expect(updatedA.morale).toBe(9); // no change for victor at diff=1
    expect(updatedB.morale).toBe(8); // -1
  });

  it('diff=2–3: victor +1 morale, loser −2 morale, 5%/10% casualties', () => {
    // A rolls 5+4=9, B rolls 3+3=6 → diff 3
    const a = seedArmy(db, { infantry: 1000, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    resolveBattle(db, a, b, null, seqRng(5 / 6, 4 / 6, 3 / 6, 3 / 6));
    const updatedA = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(a) as any;
    const updatedB = db.prepare('SELECT infantry, morale FROM armies WHERE id = ?').get(b) as any;
    expect(updatedA.infantry).toBe(950); // 5%
    expect(updatedB.infantry).toBe(900); // 10%
    expect(updatedA.morale).toBe(10);    // +1
    expect(updatedB.morale).toBe(7);     // -2
  });

  it('diff=4–5: 5%/15% casualties, capture roll generated', () => {
    // A rolls 6+5=11, B rolls 3+3=6 → diff 5; capture roll = ceil(1/6*6)=1 ≤ 1 → captured
    const a = seedArmy(db, { infantry: 1000, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    const result = resolveBattle(db, a, b, null, seqRng(6 / 6, 5 / 6, 3 / 6, 3 / 6, 1 / 6)) as any;
    expect(result.diff).toBe(5);
    expect(result.captureRoll).toBe(1);
    expect(result.loserCaptured).toBe(true);
    const updatedB = db.prepare('SELECT infantry FROM armies WHERE id = ?').get(b) as any;
    expect(updatedB.infantry).toBe(850); // 15%
  });

  it('diff=6+: 5%/20% casualties, 2-in-6 capture', () => {
    // A rolls 12, B rolls 2 → diff 10; capture roll=3 → not captured (need ≤2 for 2-in-6)
    const a = seedArmy(db, { infantry: 1000, morale: 9 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    const result = resolveBattle(db, a, b, null, seqRng(1, 1, 1 / 6, 1 / 6, 3 / 6)) as any;
    expect(result.diff).toBeGreaterThanOrEqual(6);
    expect(result.captureRoll).toBe(3);
    expect(result.loserCaptured).toBe(false);
    const updatedB = db.prepare('SELECT infantry FROM armies WHERE id = ?').get(b) as any;
    expect(updatedB.infantry).toBe(800); // 20%
  });

  it('undersupplied gives −1 modifier', () => {
    const a = seedArmy(db, { supplies: 0 });
    const b = seedArmy(db, { supplies: 10000 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(-1);
    expect(result.sideB.modifier).toBe(0);
  });

  it('morale advantage gives +N modifier to higher-morale side', () => {
    const a = seedArmy(db, { morale: 11 });
    const b = seedArmy(db, { morale: 7 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(4); // morale diff
    expect(result.sideB.modifier).toBe(0);
  });

  it('numerical advantage uses infantry_strength and cavalry_strength', () => {
    // A: infantry_strength 2000, B: infantry_strength 1000 → 2× → +3
    const a = seedArmy(db, { infantry_strength: 2000 });
    const b = seedArmy(db, { infantry_strength: 1000 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(3);
    expect(result.sideB.modifier).toBe(0);
  });

  it('cavalry_strength contributes to effective strength', () => {
    // A: cavalry_strength 600 (total effective 600), B: infantry_strength 200 (total 200) → 3× → +4
    const a = seedArmy(db, { cavalry_strength: 600 });
    const b = seedArmy(db, { infantry_strength: 200 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(4);
    expect(result.sideB.modifier).toBe(0);
  });

  it('chosen battlefield gives +1 to the defender', () => {
    const a = seedArmy(db);
    const b = seedArmy(db); // B attacks
    const result = resolveBattle(db, a, b, b, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(1); // A defends
    expect(result.sideB.modifier).toBe(0);
  });

  it('no chosen battlefield when no attacker specified', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(0);
    expect(result.sideB.modifier).toBe(0);
  });

  it('impossible battle: extra 10% casualties and no victor morale gain', () => {
    // A: infantry_strength 2000, morale 12; B: infantry_strength 100, morale 1, supplies 0
    // modA = numAdv(2000,100)=7 + moraleAdv(11)=11 = 18; modB = -1 → netDiff=19 ≥ 11
    const a = seedArmy(db, { infantry_strength: 2000, morale: 12, max_morale: 12, supplies: 1000 });
    const b = seedArmy(db, { infantry_strength: 100, morale: 1, supplies: 0 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.impossible).toBe(true);
    expect(result.victorMoraleDelta).toBe(0);
    expect(result.loserCasualtyPct).toBeGreaterThan(20); // standard + 10% extra
  });

  it('morale is clamped to max_morale on gain', () => {
    // A at morale 11 (max 12), wins diff=6+ → would gain 2, should cap at 12
    const a = seedArmy(db, { infantry: 1000, morale: 11, max_morale: 12 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    resolveBattle(db, a, b, null, seqRng(1, 1, 1 / 6, 1 / 6, 0.5));
    const updated = db.prepare('SELECT morale FROM armies WHERE id = ?').get(a) as any;
    expect(updated.morale).toBe(12);
  });

  it('morale is clamped to 1 minimum on loss', () => {
    const a = seedArmy(db, { infantry: 100, morale: 1 });
    const b = seedArmy(db, { infantry: 1000, morale: 9 });
    resolveBattle(db, a, b, null, seqRng(1 / 6, 1 / 6, 1, 1, 0.5));
    const updated = db.prepare('SELECT morale FROM armies WHERE id = ?').get(a) as any;
    expect(updated.morale).toBe(1);
  });

  it('returns hex coordinates in the result', () => {
    const a = seedArmy(db, { hex_q: 3, hex_r: -2 });
    const b = seedArmy(db, { hex_q: 3, hex_r: -2 });
    const result = resolveBattle(db, a, b, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.hexQ).toBe(3);
    expect(result.hexR).toBe(-2);
  });
});
