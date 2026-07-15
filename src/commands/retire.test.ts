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

vi.mock('../lib/db.js', () => {
  const stmt = {
    get: vi.fn().mockReturnValue({ discord_channel_id: 'chan-1' }),
  };
  return { default: { prepare: vi.fn().mockReturnValue(stmt) } };
});

function makeInteraction({
  channelInCache = true,
  memberHasRole = true,
}: { channelInCache?: boolean; memberHasRole?: boolean } = {}) {
  const factionRole = { id: 'role-1', name: 'Red Faction' };
  const commanderUser = { id: 'user-1', username: 'alice', displayName: 'Alice' };
  return {
    options: {
      getUser: vi.fn().mockReturnValue(commanderUser),
      getRole: vi.fn().mockReturnValue(factionRole),
    },
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({
          roles: {
            cache: { has: vi.fn().mockReturnValue(memberHasRole) },
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
    expect(mockRemoveRole).toHaveBeenCalledWith(expect.objectContaining({ id: 'role-1' }));
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

  it('skips role removal if member does not have the role', async () => {
    const { default: command } = await import('./retire.js');
    await command.execute(makeInteraction({ memberHasRole: false }) as any);
    expect(mockRemoveRole).not.toHaveBeenCalled();
  });

  it('still succeeds when the army channel is not found in cache', async () => {
    const { default: command } = await import('./retire.js');
    const interaction = makeInteraction({ channelInCache: false });
    await command.execute(interaction as any);
    expect(mockDeleteOverwrite).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });
});
