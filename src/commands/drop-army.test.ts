import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/admin-notify.js', () => ({ notifyAdmin: vi.fn() }));

const mockRun = vi.fn();
const mockSetParent = vi.fn().mockResolvedValue(undefined);
const mockCreateChannel = vi.fn().mockResolvedValue({ id: 'archived-cat-id' });

const armyRow = { id: 1, name: 'Iron Legion', discord_channel_id: 'chan-1' };

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT')) return { get: vi.fn().mockReturnValue(armyRow) };
      return { run: mockRun };
    }),
  },
}));

const mockArmyChannel = {
  isTextBased: () => true,
  setParent: mockSetParent,
};

function makeInteraction({ hasArchivedCategory = false } = {}) {
  const archivedCat = { id: 'archived-cat-id', name: 'Archived', type: ChannelType.GuildCategory };
  return {
    options: { getInteger: vi.fn().mockReturnValue(1) },
    guild: {
      channels: {
        cache: {
          get: vi.fn().mockReturnValue(mockArmyChannel),
          find: vi.fn().mockReturnValue(hasArchivedCategory ? archivedCat : undefined),
        },
        create: mockCreateChannel,
      },
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/drop-army', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes all orders, detachments, and the army from the DB', async () => {
    const { default: command } = await import('./drop-army.js');
    await command.execute(makeInteraction() as any);
    expect(mockRun).toHaveBeenCalledTimes(3); // DELETE orders, DELETE detachments, DELETE army
  });

  it('moves the army channel to the Archived category', async () => {
    const { default: command } = await import('./drop-army.js');
    await command.execute(makeInteraction() as any);
    expect(mockSetParent).toHaveBeenCalledWith(expect.any(String), expect.anything());
  });

  it('creates the Archived category if it does not exist', async () => {
    const { default: command } = await import('./drop-army.js');
    await command.execute(makeInteraction({ hasArchivedCategory: false }) as any);
    expect(mockCreateChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Archived', type: ChannelType.GuildCategory }),
    );
  });

  it('reuses an existing Archived category', async () => {
    const { default: command } = await import('./drop-army.js');
    await command.execute(makeInteraction({ hasArchivedCategory: true }) as any);
    expect(mockCreateChannel).not.toHaveBeenCalled();
  });

  it('notifies admin', async () => {
    const { default: command } = await import('./drop-army.js');
    await command.execute(makeInteraction() as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Iron Legion'),
    );
  });

  it('replies with an error when the army ID does not exist', async () => {
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const { default: command } = await import('./drop-army.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No army'));
    expect(mockRun).not.toHaveBeenCalled();
  });
});
