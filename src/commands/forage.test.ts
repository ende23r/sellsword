import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHex } from '../lib/db.js';

const mockHexGet = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());
const mockFetchArmyStats = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  extractSheetId: vi.fn().mockReturnValue('sheet-abc'),
}));

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) =>
      sql.startsWith('SELECT') ? { get: mockHexGet } : { run: mockRun },
    ),
  },
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi
    .fn()
    .mockReturnValue({ army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' }),
  getHex: vi.fn().mockReturnValue({ q: 0, r: 0, terrain: 'flatland', speed: 6 }),
}));

function makeInteraction() {
  return {
    user: { id: 'user-1' },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/forage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchArmyStats.mockResolvedValue({ hex_q: 0, hex_r: 0, scouting_range: 1 });
    mockHexGet.mockReturnValue({ settlement: 100, forage_count: 0 });
    vi.mocked(getHex).mockReturnValue({ q: 0, r: 0, terrain: 'flatland', speed: 6 } as never);
  });

  it('queues a forage order and reports the potential yield', async () => {
    const { default: command } = await import('./forage.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    // 7 hexes in range 1, each settlement 100 × 500
    expect(mockRun).toHaveBeenCalledTimes(2); // DELETE stale orders + INSERT forage
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('350,000'));
  });

  it('reports exhausted hexes and zero yield', async () => {
    mockHexGet.mockReturnValue({ settlement: 100, forage_count: 5 });
    const { default: command } = await import('./forage.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('exhausted'));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('0'));
  });

  it('rejects when the army is on an unknown hex', async () => {
    vi.mocked(getHex).mockReturnValue(undefined as never);
    const { default: command } = await import('./forage.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unknown hex'));
  });
});
