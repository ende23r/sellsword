import { describe, expect, it } from 'vitest';
import {
  STAT_RANGE_NAMES,
  missingStatRanges,
  parseSheetStats,
  statWriteData,
  type StatCells,
} from './sheets.js';

// ── parseSheetStats ───────────────────────────────────────────────────────────

// Helper: build a full set of stat cells keyed by named range, allow overrides.
function makeCells(overrides: Partial<StatCells> = {}): StatCells {
  return {
    infantry: 1000,
    cavalry: 200,
    wagons: 5,
    noncombatants: 50,
    morale: 9,
    resting_morale: 9,
    supplies: 5000,
    coin: 100,
    goods: 20,
    hex: '0,0',
    stance: 'allow_passage',
    infantry_strength: 900,
    cavalry_strength: 400,
    scouting_range: 2,
    max_morale: 12,
    forced_march: 0,
    night_march: 0,
    ...overrides,
  };
}

describe('parseSheetStats', () => {
  it('parses all fields from a complete cell set', () => {
    const stats = parseSheetStats(makeCells());
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
      hex_q: 0,
      hex_r: 0,
      stance: 'allow_passage',
      infantry_strength: 900,
      cavalry_strength: 400,
      scouting_range: 2,
      max_morale: 12,
      forced_march: false,
      night_march: false,
    });
  });

  it('parses numeric string values', () => {
    const stats = parseSheetStats(makeCells({ infantry: '2000', cavalry: '800' }));
    expect(stats.infantry).toBe(2000);
    expect(stats.cavalry).toBe(800);
  });

  it('defaults all fields when cells are missing entirely', () => {
    const stats = parseSheetStats({});
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
      hex_q: 0,
      hex_r: 0,
      stance: 'allow_passage',
      infantry_strength: 0,
      cavalry_strength: 0,
      scouting_range: 1,
      max_morale: 12,
      forced_march: false,
      night_march: false,
    });
  });

  it('parses hex_q and hex_r from the hex cell (format "q,r")', () => {
    const stats = parseSheetStats(makeCells({ hex: '3,-2' }));
    expect(stats.hex_q).toBe(3);
    expect(stats.hex_r).toBe(-2);
  });

  it('parses negative hex_q coordinate', () => {
    const stats = parseSheetStats(makeCells({ hex: '-5,3' }));
    expect(stats.hex_q).toBe(-5);
    expect(stats.hex_r).toBe(3);
  });

  it('defaults hex_q and hex_r to 0 when hex cell is missing', () => {
    const stats = parseSheetStats(makeCells({ hex: null }));
    expect(stats.hex_q).toBe(0);
    expect(stats.hex_r).toBe(0);
  });

  it('accepts whitespace around hex coordinates', () => {
    const stats = parseSheetStats(makeCells({ hex: ' 4 , -1 ' }));
    expect(stats.hex_q).toBe(4);
    expect(stats.hex_r).toBe(-1);
  });

  it('throws a clear error when the hex cell is malformed', () => {
    expect(() => parseSheetStats(makeCells({ hex: '12.4' }))).toThrow(/Hex cell "12\.4"/);
    expect(() => parseSheetStats(makeCells({ hex: 'abc' }))).toThrow(/expected "q,r"/);
    expect(() => parseSheetStats(makeCells({ hex: '3,' }))).toThrow(/Hex cell "3,"/);
    expect(() => parseSheetStats(makeCells({ hex: '3,x' }))).toThrow(/expected "q,r"/);
  });

  it('defaults numeric fields to 0 when cells are empty', () => {
    const stats = parseSheetStats(makeCells({ infantry: null, cavalry: '', supplies: null }));
    expect(stats.infantry).toBe(0);
    expect(stats.cavalry).toBe(0);
    expect(stats.supplies).toBe(0);
  });

  it('defaults morale to 9 when empty', () => {
    const stats = parseSheetStats(makeCells({ morale: null }));
    expect(stats.morale).toBe(9);
  });

  it('defaults scouting_range to 1 when empty', () => {
    const stats = parseSheetStats(makeCells({ scouting_range: null }));
    expect(stats.scouting_range).toBe(1);
  });

  it('defaults max_morale to 12 when empty', () => {
    const stats = parseSheetStats(makeCells({ max_morale: null }));
    expect(stats.max_morale).toBe(12);
  });

  it('rounds fractional values', () => {
    const stats = parseSheetStats(makeCells({ infantry: '999.7', morale: '8.5' }));
    expect(stats.infantry).toBe(1000);
    expect(stats.morale).toBe(9);
  });

  it('defaults non-numeric strings to safe fallbacks', () => {
    const stats = parseSheetStats(makeCells({ infantry: 'N/A', morale: 'unknown' }));
    expect(stats.infantry).toBe(0);
    expect(stats.morale).toBe(9);
  });

  it('parses stance "engage"', () => {
    expect(parseSheetStats(makeCells({ stance: 'engage' })).stance).toBe('engage');
  });

  it('treats legacy "block" as "engage"', () => {
    expect(parseSheetStats(makeCells({ stance: 'block' })).stance).toBe('engage');
  });

  it('defaults stance to "allow_passage" for unknown values', () => {
    expect(parseSheetStats(makeCells({ stance: 'invalid' })).stance).toBe('allow_passage');
    expect(parseSheetStats(makeCells({ stance: null })).stance).toBe('allow_passage');
  });

  it('parses forced_march as boolean from 1/0', () => {
    expect(parseSheetStats(makeCells({ forced_march: 1 })).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 0 })).forced_march).toBe(false);
    expect(parseSheetStats(makeCells({ forced_march: '1' })).forced_march).toBe(true);
  });

  it('parses forced_march from true/yes strings', () => {
    expect(parseSheetStats(makeCells({ forced_march: 'true' })).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 'yes' })).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 'TRUE' })).forced_march).toBe(true);
  });

  it('parses night_march as boolean', () => {
    expect(parseSheetStats(makeCells({ night_march: 1 })).night_march).toBe(true);
    expect(parseSheetStats(makeCells({ night_march: 0 })).night_march).toBe(false);
    expect(parseSheetStats(makeCells({ night_march: null })).night_march).toBe(false);
  });
});

// ── missingStatRanges ─────────────────────────────────────────────────────────

describe('missingStatRanges', () => {
  it('returns an empty list when every stat range is defined', () => {
    expect(missingStatRanges([...STAT_RANGE_NAMES])).toEqual([]);
  });

  it('ignores extra named ranges the sheet defines for its own use', () => {
    expect(missingStatRanges([...STAT_RANGE_NAMES, 'gm_notes', 'battle_history'])).toEqual([]);
  });

  it('lists every missing stat range', () => {
    const defined = STAT_RANGE_NAMES.filter((n) => n !== 'morale' && n !== 'hex');
    expect(missingStatRanges(defined)).toEqual(['morale', 'hex']);
  });

  it('reports all ranges missing for a sheet with no named ranges', () => {
    expect(missingStatRanges([])).toEqual([...STAT_RANGE_NAMES]);
  });
});

// ── statWriteData ─────────────────────────────────────────────────────────────

describe('statWriteData', () => {
  const stats = parseSheetStats(makeCells({ hex: '3,-2', forced_march: 1 }));

  it('targets named ranges, one value per range', () => {
    const data = statWriteData(stats);
    for (const entry of data) {
      expect(STAT_RANGE_NAMES).toContain(entry.range);
      expect(entry.values).toEqual([[expect.anything()]]);
    }
  });

  it('writes hex as a single "q,r" cell', () => {
    const hexEntry = statWriteData(stats).find((d) => d.range === 'hex');
    expect(hexEntry?.values).toEqual([['3,-2']]);
  });

  it('writes booleans as 1/0', () => {
    const data = statWriteData(stats);
    expect(data.find((d) => d.range === 'forced_march')?.values).toEqual([[1]]);
    expect(data.find((d) => d.range === 'night_march')?.values).toEqual([[0]]);
  });

  it('never writes the sheet-calculated read-only ranges', () => {
    const ranges = statWriteData(stats).map((d) => d.range);
    expect(ranges).not.toContain('infantry_strength');
    expect(ranges).not.toContain('cavalry_strength');
    expect(ranges).not.toContain('scouting_range');
  });
});
