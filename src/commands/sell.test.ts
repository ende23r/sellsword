import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn());
const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockFetchDemands = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  fetchDemands: mockFetchDemands,
  extractSheetId: vi.fn().mockReturnValue('sheet-abc'),
}));

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn(() => ({ run: mockRun })),
  },
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi
    .fn()
    .mockReturnValue({ army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' }),
}));

function makeInteraction() {
  return {
    user: { id: 'user-1' },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/sell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchArmyStats.mockResolvedValue({
      hex_q: 3,
      hex_r: -2,
      goods: [
        { name: 'silk', count: 300 },
        { name: 'furs', count: 50 },
      ],
    });
    mockFetchDemands.mockResolvedValue({
      demands: [{ hex_q: 3, hex_r: -2, good: 'Silk', price: 2, volume: 500 }],
      warnings: [],
    });
  });

  it('queues a sell order and previews the matching goods', async () => {
    const { default: command } = await import('./sell.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).toHaveBeenCalledTimes(2); // DELETE stale orders + INSERT sell
    const reply = (interaction.editReply.mock.calls[0][0] as string).toLowerCase();
    expect(reply).toContain('silk');
    expect(reply).toContain('2'); // price
    expect(reply).not.toContain('furs'); // no demand for furs here
  });

  it('rejects when no demand in the hex matches the army goods', async () => {
    mockFetchDemands.mockResolvedValue({
      demands: [{ hex_q: 0, hex_r: 0, good: 'silk', price: 2, volume: 500 }],
      warnings: [],
    });
    const { default: command } = await import('./sell.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No demand'));
  });

  it('rejects when the army carries no goods', async () => {
    mockFetchArmyStats.mockResolvedValue({ hex_q: 3, hex_r: -2, goods: [] });
    const { default: command } = await import('./sell.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no goods'));
  });
});
