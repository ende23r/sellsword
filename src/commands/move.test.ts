import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.fn();

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({ run: mockRun }),
  },
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1, hex_q: 2, hex_r: 3, wagons: 0 }),
  getHex: vi.fn().mockReturnValue({ terrain: 'plains' }),
}));

function makeInteraction(q: number, r: number, roadsOnly = false) {
  return {
    user: { id: 'user-1' },
    options: {
      getInteger: vi.fn().mockImplementation((key: string) => (key === 'q' ? q : r)),
      getBoolean: vi.fn().mockReturnValue(roadsOnly),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/move', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a move order for a valid destination', async () => {
    const { default: command } = await import('./move.js');
    const interaction = makeInteraction(5, 5);
    await command.execute(interaction as any);
    expect(mockRun).toHaveBeenCalledTimes(2); // DELETE then INSERT
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('cancels orders and holds when destination equals current hex', async () => {
    const { default: command } = await import('./move.js');
    const interaction = makeInteraction(2, 3); // army is already at (2,3)
    await command.execute(interaction as any);
    expect(mockRun).toHaveBeenCalledTimes(1); // DELETE only, no INSERT
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('hold'));
  });
});
