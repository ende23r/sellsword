import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockPrepare = vi.hoisted(() => vi.fn());
const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockGetStrongholdAtHex = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  extractSheetId: vi.fn().mockReturnValue('sheet-abc'),
}));

vi.mock('../lib/db.js', () => ({
  default: { prepare: mockPrepare },
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi.fn().mockReturnValue({
    army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc',
    faction_id: 7,
  }),
  getStrongholdAtHex: mockGetStrongholdAtHex,
}));

function makeInteraction() {
  return {
    user: { id: 'user-1' },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/siege', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });
    mockFetchArmyStats.mockResolvedValue({ hex_q: 3, hex_r: -2 });
    mockGetStrongholdAtHex.mockReturnValue({
      name: 'Highkeep',
      type: 'town',
      controlled_by: 'Empire',
    });
    mockGet.mockReturnValue({ name: 'Rebels' }); // commander's faction
  });

  it('queues a siege order with the stronghold hex frozen in parameters', async () => {
    const { default: command } = await import('./siege.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).toHaveBeenCalledTimes(2); // DELETE stale orders + INSERT siege
    const insertArgs = mockRun.mock.calls[1];
    expect(insertArgs[0]).toBe(1); // army id
    expect(JSON.parse(insertArgs[1] as string)).toEqual({ hex_q: 3, hex_r: -2 });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Highkeep'));
  });

  it('rejects when there is no stronghold in the hex', async () => {
    mockGetStrongholdAtHex.mockReturnValue(undefined);
    const { default: command } = await import('./siege.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no stronghold'));
  });

  it('rejects besieging a stronghold held by your own faction', async () => {
    mockGet.mockReturnValue({ name: 'Empire' }); // same as controlled_by
    const { default: command } = await import('./siege.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('own faction'));
  });
});
