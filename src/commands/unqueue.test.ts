import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeFromQueueSheet } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/sheets.js', () => ({
  removeFromQueueSheet: vi.fn(),
}));

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

vi.mock('../lib/queue-ops.js', () => ({
  removeFromQueue: vi.fn().mockReturnValue({ discord_username: 'alice' }),
}));

vi.mock('../lib/db.js', () => ({
  default: {},
}));

function makeInteraction() {
  return {
    memberPermissions: { has: vi.fn().mockReturnValue(false) },
    options: { getUser: vi.fn().mockReturnValue(null) },
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
    guild: {
      members: { fetch: vi.fn().mockResolvedValue({ roles: { remove: vi.fn() } }) },
      roles: { cache: { find: vi.fn().mockReturnValue(undefined) } },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    client: {},
  };
}

describe('/unqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies admin when sheet removal fails', async () => {
    vi.mocked(removeFromQueueSheet).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./unqueue.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('⚠️'),
    );
  });

  it('still sends a success reply when sheet removal fails', async () => {
    vi.mocked(removeFromQueueSheet).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./unqueue.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });
});
