import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockSyncArmySheet = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockExtractSheetId = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  syncArmySheet: mockSyncArmySheet,
  extractSheetId: mockExtractSheetId,
}));

const mockStats = {
  infantry: 1000, infantry_strength: 0, cavalry: 0, cavalry_strength: 0,
  wagons: 0, noncombatants: 0, scouting_range: 1, morale: 9, resting_morale: 9,
  max_morale: 12, supplies: 10000, coin: 0, goods: 0,
  hex_q: 0, hex_r: 0,
  stance: 'allow_passage' as const,
  forced_march: false, night_march: false,
};

const armyRow = { id: 7, name: 'Iron Legion', army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' };
const hexRow = { q: 3, r: -2 };

let mockArmyGet = vi.fn().mockReturnValue(armyRow);
let mockHexGet = vi.fn().mockReturnValue(hexRow);

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM armies')) return { get: mockArmyGet };
      if (sql.includes('FROM hexes')) return { get: mockHexGet };
      return { get: vi.fn() };
    }),
  },
}));

function makeInteraction(armyId = 7, q = 3, r = -2) {
  return {
    options: {
      getInteger: vi.fn((name: string) => ({ army_id: armyId, q, r }[name] ?? null)),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/teleport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArmyGet = vi.fn().mockReturnValue(armyRow);
    mockHexGet = vi.fn().mockReturnValue(hexRow);
    mockFetchArmyStats.mockResolvedValue({ ...mockStats });
    mockExtractSheetId.mockReturnValue('sheet-abc');
  });

  it('fetches stats, updates hex, and syncs to sheet', async () => {
    const { default: command } = await import('./teleport.js');
    await command.execute(makeInteraction() as any);
    expect(mockFetchArmyStats).toHaveBeenCalledWith('sheet-abc');
    expect(mockSyncArmySheet).toHaveBeenCalledWith(
      'sheet-abc',
      expect.objectContaining({ hex_q: 3, hex_r: -2 }),
    );
  });

  it('replies with the army name and destination coordinates', async () => {
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/Iron Legion/),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/3.*-2|-2.*3/),
    );
  });

  it('replies with error when army ID does not exist', async () => {
    mockArmyGet = vi.fn().mockReturnValue(undefined);
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockSyncArmySheet).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No army'));
  });

  it('replies with error when destination hex does not exist', async () => {
    mockHexGet = vi.fn().mockReturnValue(undefined);
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockSyncArmySheet).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No hex'));
  });

  it('replies with error when army has no sheet configured', async () => {
    mockExtractSheetId.mockReturnValue(null);
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockSyncArmySheet).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no sheet configured'));
  });
});
