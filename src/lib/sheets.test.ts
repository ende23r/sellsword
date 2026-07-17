import { describe, expect, it } from 'vitest';
import { parseSheetStats } from './sheets.js';

// ── parseSheetStats ───────────────────────────────────────────────────────────

// Helper: build a 17-row input with defaults, allow any row to be overridden.
// Rows map to Stats!B2:B18 (17 rows, 0-based index = B-row minus 2).
function makeRows(overrides: Record<number, string | number | null> = {}): (string | number | null)[][] {
  const defaults: (string | number | null)[] = [
    1000,  // 0  infantry
    200,   // 1  cavalry
    5,     // 2  wagons
    50,    // 3  noncombatants
    9,     // 4  morale
    9,     // 5  resting_morale
    5000,  // 6  supplies
    100,   // 7  coin
    20,    // 8  goods
    '0,0', // 9  hex (display only)
    'allow', // 10 stance
    900,   // 11 infantry_strength
    400,   // 12 cavalry_strength
    2,     // 13 scouting_range
    12,    // 14 max_morale
    0,     // 15 forced_march
    0,     // 16 night_march
  ];
  return defaults.map((v, i) => [i in overrides ? overrides[i] : v]);
}

describe('parseSheetStats', () => {
  it('parses all fields from a complete row set', () => {
    const stats = parseSheetStats(makeRows());
    expect(stats).toEqual({
      infantry: 1000,
      cavalry: 200,
      wagons: 5,
      noncombatants: 50,
      morale: 9,
      resting_morale: 9,
      supplies: 5000,
      coin: 100,
      goods: 20,
      stance: 'allow',
      infantry_strength: 900,
      cavalry_strength: 400,
      scouting_range: 2,
      max_morale: 12,
      forced_march: false,
      night_march: false,
    });
  });

  it('parses numeric string values', () => {
    const stats = parseSheetStats(makeRows({ 0: '2000', 1: '800' }));
    expect(stats.infantry).toBe(2000);
    expect(stats.cavalry).toBe(800);
  });

  it('defaults all fields when rows are missing entirely', () => {
    const stats = parseSheetStats([]);
    expect(stats).toEqual({
      infantry: 0,
      cavalry: 0,
      wagons: 0,
      noncombatants: 0,
      morale: 9,
      resting_morale: 9,
      supplies: 0,
      coin: 0,
      goods: 0,
      stance: 'allow',
      infantry_strength: 0,
      cavalry_strength: 0,
      scouting_range: 1,
      max_morale: 12,
      forced_march: false,
      night_march: false,
    });
  });

  it('defaults numeric fields to 0 when cells are empty', () => {
    const stats = parseSheetStats(makeRows({ 0: null, 1: '', 6: null }));
    expect(stats.infantry).toBe(0);
    expect(stats.cavalry).toBe(0);
    expect(stats.supplies).toBe(0);
  });

  it('defaults morale to 9 when empty', () => {
    const stats = parseSheetStats(makeRows({ 4: null }));
    expect(stats.morale).toBe(9);
  });

  it('defaults scouting_range to 1 when empty', () => {
    const stats = parseSheetStats(makeRows({ 13: null }));
    expect(stats.scouting_range).toBe(1);
  });

  it('defaults max_morale to 12 when empty', () => {
    const stats = parseSheetStats(makeRows({ 14: null }));
    expect(stats.max_morale).toBe(12);
  });

  it('rounds fractional values', () => {
    const stats = parseSheetStats(makeRows({ 0: '999.7', 4: '8.5' }));
    expect(stats.infantry).toBe(1000);
    expect(stats.morale).toBe(9);
  });

  it('defaults non-numeric strings to safe fallbacks', () => {
    const stats = parseSheetStats(makeRows({ 0: 'N/A', 4: 'unknown' }));
    expect(stats.infantry).toBe(0);
    expect(stats.morale).toBe(9);
  });

  it('parses stance "block"', () => {
    const stats = parseSheetStats(makeRows({ 10: 'block' }));
    expect(stats.stance).toBe('block');
  });

  it('defaults stance to "allow" for unknown values', () => {
    expect(parseSheetStats(makeRows({ 10: 'invalid' })).stance).toBe('allow');
    expect(parseSheetStats(makeRows({ 10: null })).stance).toBe('allow');
  });

  it('parses forced_march as boolean from 1/0', () => {
    expect(parseSheetStats(makeRows({ 15: 1 })).forced_march).toBe(true);
    expect(parseSheetStats(makeRows({ 15: 0 })).forced_march).toBe(false);
    expect(parseSheetStats(makeRows({ 15: '1' })).forced_march).toBe(true);
  });

  it('parses forced_march from true/yes strings', () => {
    expect(parseSheetStats(makeRows({ 15: 'true' })).forced_march).toBe(true);
    expect(parseSheetStats(makeRows({ 15: 'yes' })).forced_march).toBe(true);
    expect(parseSheetStats(makeRows({ 15: 'TRUE' })).forced_march).toBe(true);
  });

  it('parses night_march as boolean', () => {
    expect(parseSheetStats(makeRows({ 16: 1 })).night_march).toBe(true);
    expect(parseSheetStats(makeRows({ 16: 0 })).night_march).toBe(false);
    expect(parseSheetStats(makeRows({ 16: null })).night_march).toBe(false);
  });

  it('gracefully handles a partial row set (only first 11 rows)', () => {
    const partial = makeRows().slice(0, 11);
    const stats = parseSheetStats(partial);
    expect(stats.infantry_strength).toBe(0);
    expect(stats.cavalry_strength).toBe(0);
    expect(stats.scouting_range).toBe(1);
    expect(stats.max_morale).toBe(12);
    expect(stats.forced_march).toBe(false);
    expect(stats.night_march).toBe(false);
  });
});
