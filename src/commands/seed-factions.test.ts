import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFactionSeed, syncFactions } from '../lib/faction-sync.js';

vi.mock('../lib/faction-sync.js', () => ({
  readFactionSeed: vi.fn(),
  syncFactions: vi.fn().mockResolvedValue(['Created role: Red', 'Created category: Red']),
}));

vi.mock('../lib/db.js', () => ({ default: {} }));

function makeInteraction() {
  return {
    guild: { id: 'guild-1', name: 'Test Guild' },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/seed-factions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs sync and reports what was done', async () => {
    vi.mocked(readFactionSeed).mockReturnValue([{ name: 'Red', color: '#FF0000' }]);
    const { default: command } = await import('./seed-factions.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(syncFactions).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Red'));
  });

  it('reports when the seed file is missing', async () => {
    vi.mocked(readFactionSeed).mockReturnValue([]);
    const { default: command } = await import('./seed-factions.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(syncFactions).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('faction-seed.json'));
  });
});
