import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';
import { upsertFaction } from '../lib/faction-ops.js';

const mockQueueGet = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

vi.mock('../lib/faction-ops.js', () => ({
  upsertFaction: vi.fn().mockReturnValue(1),
}));

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) =>
      sql.startsWith('SELECT') ? { get: mockQueueGet } : { run: mockRun },
    ),
  },
}));

const factionRole = { id: 'role-1', name: 'Red Faction' };

function makeInteraction({ memberInGuild = true } = {}) {
  const member = { roles: { add: vi.fn(), remove: vi.fn() } };
  return {
    user: { id: 'admin-1', toString: () => '@admin' },
    options: {
      getRole: vi.fn().mockReturnValue(factionRole),
      getUser: vi.fn().mockReturnValue(null),
    },
    guild: {
      members: {
        fetch: memberInGuild
          ? vi.fn().mockResolvedValue(member)
          : vi.fn().mockRejectedValue(new Error('Unknown Member')),
      },
      roles: { cache: { find: vi.fn().mockReturnValue(undefined) } },
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member,
  };
}

describe('/recruit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueGet.mockReturnValue({ discord_user_id: 'user-1', discord_username: 'alice' });
  });

  it('recruits the queue top into the faction', async () => {
    const { default: command } = await import('./recruit.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(upsertFaction).toHaveBeenCalled();
    expect(interaction.member.roles.add).toHaveBeenCalledWith('role-1');
    expect(mockRun).toHaveBeenCalledWith('user-1'); // queue row deleted
    expect(notifyAdmin).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('alice'));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('reports an empty queue', async () => {
    mockQueueGet.mockReturnValue(undefined);
    const { default: command } = await import('./recruit.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('queue is empty'));
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('reports when the user is no longer in the server', async () => {
    const { default: command } = await import('./recruit.js');
    const interaction = makeInteraction({ memberInGuild: false });
    await command.execute(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Could not find user'),
    );
    expect(mockRun).not.toHaveBeenCalled();
  });
});
