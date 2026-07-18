import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

const mockRemoveRole = vi.fn().mockResolvedValue(undefined);
const mockDeleteOverwrite = vi.fn().mockResolvedValue(undefined);
const mockChannel = {
  isTextBased: () => true,
  toString: () => '#army-alice',
  permissionOverwrites: { delete: mockDeleteOverwrite },
};

const factionRole = { id: 'role-1', name: 'Red Faction' };

vi.mock('../lib/db.js', () => {
  return {
    default: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('factions')) {
          return { all: vi.fn().mockReturnValue([{ discord_role_id: 'role-1' }]) };
        }
        return { get: vi.fn().mockReturnValue({ discord_channel_id: 'chan-1' }) };
      }),
    },
  };
});

function makeInteraction({
  channelInCache = true,
  memberHasFactionRole = true,
}: { channelInCache?: boolean; memberHasFactionRole?: boolean } = {}) {
  const commanderUser = { id: 'user-1', username: 'alice', displayName: 'Alice' };
  return {
    options: {
      getUser: vi.fn().mockReturnValue(commanderUser),
    },
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({
          roles: {
            cache: {
              find: vi.fn().mockReturnValue(memberHasFactionRole ? factionRole : undefined),
            },
            remove: mockRemoveRole,
          },
        }),
      },
      channels: {
        cache: { get: vi.fn().mockReturnValue(channelInCache ? mockChannel : undefined) },
      },
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/retire', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the faction role from the member', async () => {
    const { default: command } = await import('./retire.js');
    await command.execute(makeInteraction() as any);
    expect(mockRemoveRole).toHaveBeenCalledWith(factionRole);
  });

  it('removes the permission overwrite on the army channel', async () => {
    const { default: command } = await import('./retire.js');
    await command.execute(makeInteraction() as any);
    expect(mockDeleteOverwrite).toHaveBeenCalledWith('user-1');
  });

  it('sends a success reply', async () => {
    const { default: command } = await import('./retire.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('notifies admin', async () => {
    const { default: command } = await import('./retire.js');
    await command.execute(makeInteraction() as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('alice'),
    );
  });

  it('skips role removal if member has no faction role', async () => {
    const { default: command } = await import('./retire.js');
    await command.execute(makeInteraction({ memberHasFactionRole: false }) as any);
    expect(mockRemoveRole).not.toHaveBeenCalled();
  });

  it('still revokes channel access when the member has left the guild', async () => {
    const { default: command } = await import('./retire.js');
    const interaction = makeInteraction();
    interaction.guild.members.fetch = vi.fn().mockRejectedValue(new Error('Unknown Member'));
    await command.execute(interaction as any);
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(mockDeleteOverwrite).toHaveBeenCalledWith('user-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('still succeeds when the army channel is not found in cache', async () => {
    const { default: command } = await import('./retire.js');
    const interaction = makeInteraction({ channelInCache: false });
    await command.execute(interaction as any);
    expect(mockDeleteOverwrite).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });
});
