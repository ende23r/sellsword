import { describe, expect, it } from 'vitest';
import {
  STAT_RANGE_NAMES,
  isCavalryOnly,
  missingStatRanges,
  parseDetachments,
  parseSheetStats,
  statWriteData,
  supplyUpkeep,
  totalStrength,
  totalWagons,
  type StatCells,
} from './sheets.js';

// ── parseSheetStats ───────────────────────────────────────────────────────────

// Helper: build a full set of scalar stat cells keyed by named range, allow overrides.
function makeCells(overrides: Partial<StatCells> = {}): StatCells {
  return {
    noncombatants: 50,
    morale: 9,
    resting_morale: 9,
    supplies: 5000,
    coin: 100,
    goods: 20,
    hex: '0,0',
    stance: 'allow_passage',
    scouting_range: 2,
    max_morale: 12,
    forced_march: 0,
    night_march: 0,
    ...overrides,
  };
}

// Rows as read from the `detachments` named range: name | size | notes | multiplier | strength | wagons
const DETACHMENT_ROWS: (string | number | null)[][] = [
  ['1st Chiliarchy', 1000, 'infantry', 1, 900, 3],
  ['Companions', 200, 'heavy cavalry, Honor of Aegyssus', 10, 400, 2],
];

describe('parseSheetStats', () => {
  it('parses all fields from a complete cell set', () => {
    const stats = parseSheetStats(makeCells(), DETACHMENT_ROWS);
    expect(stats).toEqual({
      noncombatants: 50,
      morale: 9,
      resting_morale: 9,
      supplies: 5000,
      coin: 100,
      goods: 20,
      hex_q: 0,
      hex_r: 0,
      stance: 'allow_passage',
      scouting_range: 2,
      max_morale: 12,
      forced_march: false,
      night_march: false,
      detachments: [
        { name: '1st Chiliarchy', size: 1000, notes: 'infantry', multiplier: 1, strength: 900, wagons: 3 },
        {
          name: 'Companions',
          size: 200,
          notes: 'heavy cavalry, Honor of Aegyssus',
          multiplier: 10,
          strength: 400,
          wagons: 2,
        },
      ],
    });
  });

  it('defaults all fields when cells are missing entirely', () => {
    const stats = parseSheetStats({}, []);
    expect(stats).toEqual({
      noncombatants: 0,
      morale: 9,
      resting_morale: 9,
      supplies: 0,
      coin: 0,
      goods: 0,
      hex_q: 0,
      hex_r: 0,
      stance: 'allow_passage',
      scouting_range: 1,
      max_morale: 12,
      forced_march: false,
      night_march: false,
      detachments: [],
    });
  });

  it('parses hex_q and hex_r from the hex cell (format "q,r")', () => {
    const stats = parseSheetStats(makeCells({ hex: '3,-2' }), []);
    expect(stats.hex_q).toBe(3);
    expect(stats.hex_r).toBe(-2);
  });

  it('parses negative hex_q coordinate', () => {
    const stats = parseSheetStats(makeCells({ hex: '-5,3' }), []);
    expect(stats.hex_q).toBe(-5);
    expect(stats.hex_r).toBe(3);
  });

  it('defaults hex_q and hex_r to 0 when hex cell is missing', () => {
    const stats = parseSheetStats(makeCells({ hex: null }), []);
    expect(stats.hex_q).toBe(0);
    expect(stats.hex_r).toBe(0);
  });

  it('accepts whitespace around hex coordinates', () => {
    const stats = parseSheetStats(makeCells({ hex: ' 4 , -1 ' }), []);
    expect(stats.hex_q).toBe(4);
    expect(stats.hex_r).toBe(-1);
  });

  it('throws a clear error when the hex cell is malformed', () => {
    expect(() => parseSheetStats(makeCells({ hex: '12.4' }), [])).toThrow(/Hex cell "12\.4"/);
    expect(() => parseSheetStats(makeCells({ hex: 'abc' }), [])).toThrow(/expected "q,r"/);
    expect(() => parseSheetStats(makeCells({ hex: '3,' }), [])).toThrow(/Hex cell "3,"/);
    expect(() => parseSheetStats(makeCells({ hex: '3,x' }), [])).toThrow(/expected "q,r"/);
  });

  it('defaults numeric fields to 0 when cells are empty', () => {
    const stats = parseSheetStats(makeCells({ noncombatants: null, supplies: '' }), []);
    expect(stats.noncombatants).toBe(0);
    expect(stats.supplies).toBe(0);
  });

  it('defaults morale to 9 when empty', () => {
    expect(parseSheetStats(makeCells({ morale: null }), []).morale).toBe(9);
  });

  it('defaults scouting_range to 1 when empty', () => {
    expect(parseSheetStats(makeCells({ scouting_range: null }), []).scouting_range).toBe(1);
  });

  it('defaults max_morale to 12 when empty', () => {
    expect(parseSheetStats(makeCells({ max_morale: null }), []).max_morale).toBe(12);
  });

  it('rounds fractional values', () => {
    const stats = parseSheetStats(makeCells({ noncombatants: '49.7', morale: '8.5' }), []);
    expect(stats.noncombatants).toBe(50);
    expect(stats.morale).toBe(9);
  });

  it('defaults non-numeric strings to safe fallbacks', () => {
    const stats = parseSheetStats(makeCells({ noncombatants: 'N/A', morale: 'unknown' }), []);
    expect(stats.noncombatants).toBe(0);
    expect(stats.morale).toBe(9);
  });

  it('parses stance "engage"', () => {
    expect(parseSheetStats(makeCells({ stance: 'engage' }), []).stance).toBe('engage');
  });

  it('treats legacy "block" as "engage"', () => {
    expect(parseSheetStats(makeCells({ stance: 'block' }), []).stance).toBe('engage');
  });

  it('defaults stance to "allow_passage" for unknown values', () => {
    expect(parseSheetStats(makeCells({ stance: 'invalid' }), []).stance).toBe('allow_passage');
    expect(parseSheetStats(makeCells({ stance: null }), []).stance).toBe('allow_passage');
  });

  it('parses forced_march as boolean from 1/0', () => {
    expect(parseSheetStats(makeCells({ forced_march: 1 }), []).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 0 }), []).forced_march).toBe(false);
    expect(parseSheetStats(makeCells({ forced_march: '1' }), []).forced_march).toBe(true);
  });

  it('parses forced_march from true/yes strings', () => {
    expect(parseSheetStats(makeCells({ forced_march: 'true' }), []).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 'yes' }), []).forced_march).toBe(true);
    expect(parseSheetStats(makeCells({ forced_march: 'TRUE' }), []).forced_march).toBe(true);
  });

  it('parses night_march as boolean', () => {
    expect(parseSheetStats(makeCells({ night_march: 1 }), []).night_march).toBe(true);
    expect(parseSheetStats(makeCells({ night_march: 0 }), []).night_march).toBe(false);
    expect(parseSheetStats(makeCells({ night_march: null }), []).night_march).toBe(false);
  });
});

// ── parseDetachments ──────────────────────────────────────────────────────────

describe('parseDetachments', () => {
  it('parses rows in column order name | size | notes | multiplier | strength | wagons', () => {
    expect(parseDetachments(DETACHMENT_ROWS)).toEqual([
      { name: '1st Chiliarchy', size: 1000, notes: 'infantry', multiplier: 1, strength: 900, wagons: 3 },
      {
        name: 'Companions',
        size: 200,
        notes: 'heavy cavalry, Honor of Aegyssus',
        multiplier: 10,
        strength: 400,
        wagons: 2,
      },
    ]);
  });

  it('skips fully blank rows', () => {
    const rows = [DETACHMENT_ROWS[0], ['', '', '', '', '', ''], [null], DETACHMENT_ROWS[1]];
    expect(parseDetachments(rows)).toHaveLength(2);
  });

  it('defaults multiplier to 1 and strength and wagons to 0 when empty', () => {
    const [d] = parseDetachments([['Levies', 500, '', '', '', '']]);
    expect(d).toEqual({ name: 'Levies', size: 500, notes: '', multiplier: 1, strength: 0, wagons: 0 });
  });

  it('allows fractional multipliers for custom detachment types', () => {
    const [d] = parseDetachments([['Camels', 100, '', '2.5', 80, 0]]);
    expect(d.multiplier).toBe(2.5);
  });

  it('throws a clear error when size is missing on a non-blank row', () => {
    expect(() => parseDetachments([['Ghosts', '', '', 1, 10, 0]])).toThrow(/Detachment row 1 \("Ghosts"\)/);
  });

  it('throws a clear error naming the row when a number is malformed', () => {
    const rows = [DETACHMENT_ROWS[0], ['2nd Chiliarchy', 'lots', '', 1, 0, 0]];
    expect(() => parseDetachments(rows)).toThrow(/Detachment row 2 \("2nd Chiliarchy"\).*size.*"lots"/);
  });

  it('throws when a header row is inside the named range', () => {
    expect(() => parseDetachments([['name', 'size', 'notes', 'multiplier', 'strength', 'wagons']])).toThrow(
      /Detachment row 1/,
    );
  });

  it('rejects negative sizes', () => {
    expect(() => parseDetachments([['Void', -100, '', 1, 0, 0]])).toThrow(/Detachment row 1/);
  });
});

// ── derived totals ────────────────────────────────────────────────────────────

describe('derived detachment totals', () => {
  const stats = parseSheetStats(makeCells(), DETACHMENT_ROWS);

  it('totalWagons sums wagons across detachments', () => {
    expect(totalWagons(stats)).toBe(5);
  });

  it('totalStrength sums strength across detachments', () => {
    expect(totalStrength(stats)).toBe(1300);
  });

  it('supplyUpkeep sums size × multiplier', () => {
    // 1000×1 + 200×10
    expect(supplyUpkeep(stats)).toBe(3000);
  });

  it('all totals are 0 for an army with no detachments', () => {
    const empty = parseSheetStats(makeCells(), []);
    expect(totalWagons(empty)).toBe(0);
    expect(totalStrength(empty)).toBe(0);
    expect(supplyUpkeep(empty)).toBe(0);
  });

  it('isCavalryOnly is true when every detachment is mounted (multiplier ≥ 10) and wagonless', () => {
    const cav = parseSheetStats(makeCells(), [['Companions', 200, '', 10, 400, 0]]);
    expect(isCavalryOnly(cav)).toBe(true);
  });

  it('isCavalryOnly is false when any detachment is on foot or has wagons', () => {
    expect(isCavalryOnly(parseSheetStats(makeCells(), DETACHMENT_ROWS))).toBe(false);
    const cavWithWagons = parseSheetStats(makeCells(), [['Companions', 200, '', 10, 400, 1]]);
    expect(isCavalryOnly(cavWithWagons)).toBe(false);
  });

  it('isCavalryOnly is false for an army with no detachments', () => {
    expect(isCavalryOnly(parseSheetStats(makeCells(), []))).toBe(false);
  });
});

// ── missingStatRanges ─────────────────────────────────────────────────────────

describe('missingStatRanges', () => {
  it('includes the detachments range in the requirements', () => {
    expect(STAT_RANGE_NAMES).toContain('detachments');
  });

  it('returns an empty list when every stat range is defined', () => {
    expect(missingStatRanges([...STAT_RANGE_NAMES])).toEqual([]);
  });

  it('ignores extra named ranges the sheet defines for its own use', () => {
    expect(missingStatRanges([...STAT_RANGE_NAMES, 'gm_notes', 'battle_history'])).toEqual([]);
  });

  it('lists every missing stat range', () => {
    const defined = STAT_RANGE_NAMES.filter((n) => n !== 'morale' && n !== 'detachments');
    expect(missingStatRanges(defined)).toEqual(['morale', 'detachments']);
  });

  it('reports all ranges missing for a sheet with no named ranges', () => {
    expect(missingStatRanges([])).toEqual([...STAT_RANGE_NAMES]);
  });
});

// ── statWriteData ─────────────────────────────────────────────────────────────

describe('statWriteData', () => {
  const stats = parseSheetStats(makeCells({ hex: '3,-2', forced_march: 1 }), DETACHMENT_ROWS);

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

  it('only writes the ranges the bot owns — GM-owned ranges are never written', () => {
    const ranges = statWriteData(stats).map((d) => d.range);
    expect(ranges.sort()).toEqual(
      ['morale', 'supplies', 'coin', 'goods', 'hex', 'stance', 'forced_march', 'night_march'].sort(),
    );
    expect(ranges).not.toContain('detachments');
    expect(ranges).not.toContain('noncombatants');
    expect(ranges).not.toContain('resting_morale');
    expect(ranges).not.toContain('max_morale');
    expect(ranges).not.toContain('scouting_range');
  });
});
