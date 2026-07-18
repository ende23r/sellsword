import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import type { ArmySheetStats, Detachment } from './sheets.js';
import { effectiveStrength, numericalAdvantage, resolveBattle } from './battle.js';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DB_SCHEMA);
  return db;
}

let seq = 0;

function seedArmy(db: Database.Database, overrides: { id?: number } = {}): number {
  const id = overrides.id ?? ++seq;
  db.prepare('INSERT INTO commanders (id, discord_user_id) VALUES (?, ?)').run(id, `user-${id}`);
  db.prepare('INSERT INTO armies (id, commander_id) VALUES (?, ?)').run(id, id);
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
    goods: 0,
    hex_q: 0,
    hex_r: 0,
    stance: 'allow_passage',
    forced_march: false,
    night_march: false,
    ...overrides,
  };
}

// Produce a deterministic rng from a sequence of values.
// Math.ceil(val * 6) gives the die face for each value.
function seqRng(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++] ?? 0.5;
}

describe('effectiveStrength', () => {
  it('sums detachment strengths + noncombatants', () => {
    const stats = makeStats({
      infantry_detachments: [det({ strength: 1000 })],
      cavalry_detachments: [det({ strength: 400 })],
      noncombatants: 300,
    });
    expect(effectiveStrength(stats)).toBe(1700);
  });

  it('excludes raw sizes and wagons', () => {
    const stats = makeStats({ infantry_detachments: [det({ size: 5000, wagons: 20, strength: 0 })] });
    expect(effectiveStrength(stats)).toBe(0);
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
    const stats = new Map([[2, makeStats()]]);
    const result = resolveBattle(db, 99, 2, stats, null);
    expect(result).toEqual({ error: expect.stringContaining('99') });
  });

  it('returns an error when army B is not found', () => {
    const a = seedArmy(db);
    const stats = new Map([[a, makeStats()]]);
    const result = resolveBattle(db, a, 99, stats, null);
    expect(result).toEqual({ error: expect.stringContaining('99') });
  });

  it('returns an error when armies are not in the same hex', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([
      [a, makeStats({ hex_q: 0, hex_r: 0 })],
      [b, makeStats({ hex_q: 1, hex_r: 0 })],
    ]);
    const result = resolveBattle(db, a, b, stats, null);
    expect(result).toEqual({ error: expect.stringContaining('same hex') });
  });

  it('returns an error when stats are missing for army A', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, null);
    expect(result).toEqual({ error: expect.stringContaining(String(a)) });
  });

  it('higher total wins', () => {
    // A rolls 12 (1,1 → ceil(1*6)=6 each), B rolls 2 (1/6,1/6 → ceil(1)=1 each)
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(1, 1, 1 / 6, 1 / 6)) as any;
    expect(result.winner).toBe('a');
    expect(result.sideA.roll).toBe(12);
    expect(result.sideB.roll).toBe(2);
  });

  it('tie with no attacker is a draw', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    // Both roll 6 (0.5 → ceil(3)=3, 3+3=6)
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.winner).toBe('draw');
  });

  it('tie with B attacking: A (defender) holds', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    // A defends (+1 mod). A rolls 5, B rolls 6 → totals 6 vs 6 → tie, A holds.
    const result = resolveBattle(db, a, b, stats, b, seqRng(2 / 6, 3 / 6, 3 / 6, 3 / 6)) as any;
    expect(result.winner).toBe('a');
    expect(result.diff).toBe(0);
  });

  it('tie with A attacking: B (defender) holds', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    // B defends (+1 mod). A rolls 6, B rolls 5 → totals 6 vs 6 → tie, B holds.
    const result = resolveBattle(db, a, b, stats, a, seqRng(3 / 6, 3 / 6, 2 / 6, 3 / 6)) as any;
    expect(result.winner).toBe('b');
    expect(result.diff).toBe(0);
  });

  it('diff=0 with attacker: attacker loses 1 morale, casualties reported not applied', () => {
    // B attacks, A defends. A gets +1 (chosen battlefield). A rolls 5, B rolls 6 → totals tie.
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 9 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    const result = resolveBattle(db, a, b, stats, b, seqRng(2 / 6, 3 / 6, 3 / 6, 3 / 6)) as any;
    expect(result.victorCasualtyPct).toBe(5);
    expect(result.loserCasualtyPct).toBe(5);
    expect(statsA.morale).toBe(9); // no morale change for defender
    expect(statsB.morale).toBe(8); // -1 attacker penalty
  });

  it('never modifies detachments or noncombatants — casualties are applied manually by the GM', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ infantry_detachments: [det({ size: 1000, wagons: 3 })], noncombatants: 50 });
    const statsB = makeStats({ infantry_detachments: [det({ size: 800 })], noncombatants: 20 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    // A crushes B (diff 6+, 20% loser casualties)
    resolveBattle(db, a, b, stats, null, seqRng(1, 1, 1 / 6, 1 / 6, 0.5));
    expect(statsA.infantry_detachments).toEqual([det({ size: 1000, wagons: 3 })]);
    expect(statsA.noncombatants).toBe(50);
    expect(statsB.infantry_detachments).toEqual([det({ size: 800 })]);
    expect(statsB.noncombatants).toBe(20);
  });

  it('draw: 5% casualties reported, no morale change', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 9 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.victorCasualtyPct).toBe(5);
    expect(result.loserCasualtyPct).toBe(5);
    expect(statsA.morale).toBe(9);
    expect(statsB.morale).toBe(9);
  });

  it('diff=1: 10% casualties reported for both, loser −1 morale', () => {
    // A rolls 4+3=7, B rolls 3+3=6 → diff 1, A wins
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 9 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(4 / 6, 3 / 6, 3 / 6, 3 / 6)) as any;
    expect(result.victorCasualtyPct).toBe(10);
    expect(result.loserCasualtyPct).toBe(10);
    expect(statsA.morale).toBe(9); // no change for victor at diff=1
    expect(statsB.morale).toBe(8); // -1
  });

  it('diff=2–3: victor +1 morale, loser −2 morale, 5%/10% casualties reported', () => {
    // A rolls 5+4=9, B rolls 3+3=6 → diff 3
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 9 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(5 / 6, 4 / 6, 3 / 6, 3 / 6)) as any;
    expect(result.victorCasualtyPct).toBe(5);
    expect(result.loserCasualtyPct).toBe(10);
    expect(statsA.morale).toBe(10); // +1
    expect(statsB.morale).toBe(7); // -2
  });

  it('diff=4–5: 5%/15% casualties reported, capture roll generated', () => {
    // A rolls 6+5=11, B rolls 3+3=6 → diff 5; capture roll = ceil(1/6*6)=1 ≤ 1 → captured
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(6 / 6, 5 / 6, 3 / 6, 3 / 6, 1 / 6)) as any;
    expect(result.diff).toBe(5);
    expect(result.captureRoll).toBe(1);
    expect(result.loserCaptured).toBe(true);
    expect(result.loserCasualtyPct).toBe(15);
  });

  it('diff=6+: 5%/20% casualties reported, 2-in-6 capture', () => {
    // A rolls 12, B rolls 2 → diff 10; capture roll=3 → not captured (need ≤2 for 2-in-6)
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(1, 1, 1 / 6, 1 / 6, 3 / 6)) as any;
    expect(result.diff).toBeGreaterThanOrEqual(6);
    expect(result.captureRoll).toBe(3);
    expect(result.loserCaptured).toBe(false);
    expect(result.loserCasualtyPct).toBe(20);
  });

  it('undersupplied gives −1 modifier', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats({ supplies: 0 })], [b, makeStats({ supplies: 10000 })]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(-1);
    expect(result.sideB.modifier).toBe(0);
  });

  it('morale advantage gives +N modifier to higher-morale side', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats({ morale: 11 })], [b, makeStats({ morale: 7 })]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(4); // morale diff
    expect(result.sideB.modifier).toBe(0);
  });

  it('numerical advantage uses summed detachment strength', () => {
    // A: strength 2000, B: strength 1000 → 2× → +3
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([
      [a, makeStats({ infantry_detachments: [det({ strength: 2000 })] })],
      [b, makeStats({ infantry_detachments: [det({ strength: 1000 })] })],
    ]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(3);
    expect(result.sideB.modifier).toBe(0);
  });

  it('strength sums across multiple detachments', () => {
    // A: 400 + 200 = 600 effective, B: 200 → 3× → +4
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([
      [a, makeStats({ infantry_detachments: [det({ strength: 400 })], cavalry_detachments: [det({ strength: 200 })] })],
      [b, makeStats({ infantry_detachments: [det({ strength: 200 })] })],
    ]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(4);
    expect(result.sideB.modifier).toBe(0);
  });

  it('chosen battlefield gives +1 to the defender', () => {
    const a = seedArmy(db);
    const b = seedArmy(db); // B attacks
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, b, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(1); // A defends
    expect(result.sideB.modifier).toBe(0);
  });

  it('no chosen battlefield when no attacker specified', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([[a, makeStats()], [b, makeStats()]]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.sideA.modifier).toBe(0);
    expect(result.sideB.modifier).toBe(0);
  });

  it('impossible battle: extra 10% casualties reported and no victor morale gain', () => {
    // A: strength 2000, morale 12; B: strength 100, morale 1, supplies 0
    // modA = numAdv(2000,100)=7 + moraleAdv(11)=11 = 18; modB = -1 → netDiff=19 ≥ 11
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([
      [a, makeStats({ infantry_detachments: [det({ strength: 2000 })], morale: 12, max_morale: 12, supplies: 1000 })],
      [b, makeStats({ infantry_detachments: [det({ strength: 100 })], morale: 1, supplies: 0 })],
    ]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.impossible).toBe(true);
    expect(result.victorMoraleDelta).toBe(0);
    expect(result.loserCasualtyPct).toBeGreaterThan(20); // standard + 10% extra
  });

  it('morale is clamped to max_morale on gain', () => {
    // A at morale 11 (max 12), wins diff=6+ → would gain 2, should cap at 12
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 11, max_morale: 12 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    resolveBattle(db, a, b, stats, null, seqRng(1, 1, 1 / 6, 1 / 6, 0.5));
    expect(statsA.morale).toBe(12);
  });

  it('morale is clamped to 1 minimum on loss', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const statsA = makeStats({ morale: 1 });
    const statsB = makeStats({ morale: 9 });
    const stats = new Map([[a, statsA], [b, statsB]]);
    resolveBattle(db, a, b, stats, null, seqRng(1 / 6, 1 / 6, 1, 1, 0.5));
    expect(statsA.morale).toBe(1);
  });

  it('returns hex coordinates in the result', () => {
    const a = seedArmy(db);
    const b = seedArmy(db);
    const stats = new Map([
      [a, makeStats({ hex_q: 3, hex_r: -2 })],
      [b, makeStats({ hex_q: 3, hex_r: -2 })],
    ]);
    const result = resolveBattle(db, a, b, stats, null, seqRng(0.5, 0.5, 0.5, 0.5)) as any;
    expect(result.hexQ).toBe(3);
    expect(result.hexR).toBe(-2);
  });
});
