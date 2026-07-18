import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHex } from '../lib/db.js';

const mockRun = vi.hoisted(() => vi.fn());
const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockExtractSheetId = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  extractSheetId: mockExtractSheetId,
}));

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({ run: mockRun }),
  },
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi.fn().mockReturnValue({ army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' }),
  getHex: vi.fn().mockReturnValue({ terrain: 'flatland', speed: 6 }),
}));

function makeInteraction(q: number, r: number, roadsOnly = false) {
  return {
    user: { id: 'user-1' },
    options: {
      getInteger: vi.fn().mockImplementation((key: string) => (key === 'q' ? q : r)),
      getBoolean: vi.fn().mockReturnValue(roadsOnly),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferred: true,
  };
}

describe('/move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchArmyStats.mockResolvedValue({
      infantry: 0, cavalry: 0, wagons: 0, noncombatants: 0,
      morale: 9, resting_morale: 9, max_morale: 12,
      supplies: 0, coin: 0, goods: 0,
      stance: 'allow_passage' as const,
      infantry_strength: 0, cavalry_strength: 0, scouting_range: 1,
      forced_march: false, night_march: false,
      hex_q: 2, hex_r: 3,
    });
    mockExtractSheetId.mockReturnValue('sheet-abc');
  });

  it('inserts a move order for a valid destination', async () => {
    const { default: command } = await import('./move.js');
    const interaction = makeInteraction(5, 5);
    await command.execute(interaction as any);
    expect(mockRun).toHaveBeenCalledTimes(2); // DELETE then INSERT
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('rejects movement to an impassable hex (speed=0)', async () => {
    vi.mocked(getHex).mockReturnValueOnce({ terrain: 'sea', speed: 0 } as any);
    const { default: command } = await import('./move.js');
    const interaction = makeInteraction(5, 5);
    await command.execute(interaction as any);
    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('impassable') }),
    );
  });

  it('cancels orders and holds when destination equals current hex', async () => {
    const { default: command } = await import('./move.js');
    const interaction = makeInteraction(2, 3); // stats say army is at (2,3)
    await command.execute(interaction as any);
    expect(mockRun).toHaveBeenCalledTimes(1); // DELETE only, no INSERT
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('hold'));
  });
});
