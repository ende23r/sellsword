import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { applySheetStats, parseSheetStats } from './sheets.js';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DB_SCHEMA);
  return db;
}

function seedArmy(db: Database.Database, id = 1) {
  db.prepare('INSERT INTO commanders (id, discord_user_id) VALUES (?, ?)').run(id, `user-${id}`);
  db.prepare('INSERT INTO armies (id, commander_id) VALUES (?, ?)').run(id, id);
  return id;
}

// ── parseSheetStats ───────────────────────────────────────────────────────────

describe('parseSheetStats', () => {
  it('parses numeric string values from sheet rows', () => {
    const stats = parseSheetStats([['2000'], ['800'], ['2']]);
    expect(stats).toEqual({ infantry_strength: 2000, cavalry_strength: 800, scouting_range: 2 });
  });

  it('parses integer values (already numbers)', () => {
    const stats = parseSheetStats([[1500], [300], [1]] as any);
    expect(stats).toEqual({ infantry_strength: 1500, cavalry_strength: 300, scouting_range: 1 });
  });

  it('defaults infantry_strength to 0 when cell is empty', () => {
    expect(parseSheetStats([[], ['300'], ['1']]).infantry_strength).toBe(0);
  });

  it('defaults cavalry_strength to 0 when cell is empty', () => {
    expect(parseSheetStats([['1000'], [], ['1']]).cavalry_strength).toBe(0);
  });

  it('defaults scouting_range to 1 when cell is empty', () => {
    expect(parseSheetStats([['1000'], ['300'], []]).scouting_range).toBe(1);
  });

  it('defaults all fields when rows are missing entirely', () => {
    expect(parseSheetStats([])).toEqual({
      infantry_strength: 0,
      cavalry_strength: 0,
      scouting_range: 1,
    });
  });

  it('defaults to 0/0/1 when cells contain non-numeric strings', () => {
    expect(parseSheetStats([['N/A'], ['—'], ['unknown']])).toEqual({
      infantry_strength: 0,
      cavalry_strength: 0,
      scouting_range: 1,
    });
  });

  it('rounds fractional values', () => {
    expect(parseSheetStats([['1999.7'], ['299.3'], ['1.6']]).infantry_strength).toBe(2000);
    expect(parseSheetStats([['1999.7'], ['299.3'], ['1.6']]).scouting_range).toBe(2);
  });
});

// ── applySheetStats ───────────────────────────────────────────────────────────

describe('applySheetStats', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    seedArmy(db);
  });

  it('writes all three fields to the army row', () => {
    applySheetStats(db, 1, { infantry_strength: 2000, cavalry_strength: 400, scouting_range: 2 });
    const row = db.prepare('SELECT infantry_strength, cavalry_strength, scouting_range FROM armies WHERE id = 1').get() as any;
    expect(row.infantry_strength).toBe(2000);
    expect(row.cavalry_strength).toBe(400);
    expect(row.scouting_range).toBe(2);
  });

  it('does not affect other army columns', () => {
    db.prepare('UPDATE armies SET infantry = 500, morale = 11 WHERE id = 1').run();
    applySheetStats(db, 1, { infantry_strength: 2000, cavalry_strength: 0, scouting_range: 1 });
    const row = db.prepare('SELECT infantry, morale FROM armies WHERE id = 1').get() as any;
    expect(row.infantry).toBe(500);
    expect(row.morale).toBe(11);
  });

  it('does not affect other armies', () => {
    seedArmy(db, 2);
    applySheetStats(db, 1, { infantry_strength: 9999, cavalry_strength: 0, scouting_range: 1 });
    const other = db.prepare('SELECT infantry_strength FROM armies WHERE id = 2').get() as any;
    expect(other.infantry_strength).toBe(0);
  });

  it('is a no-op when army id does not exist', () => {
    expect(() =>
      applySheetStats(db, 999, { infantry_strength: 1, cavalry_strength: 1, scouting_range: 1 }),
    ).not.toThrow();
  });
});
