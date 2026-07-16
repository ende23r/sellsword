import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendToQueue } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/sheets.js', () => ({
  appendToQueue: vi.fn(),
}));

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

vi.mock('../lib/db.js', () => {
  const stmt = { get: vi.fn().mockReturnValue(undefined), run: vi.fn() };
  return { default: { prepare: vi.fn().mockReturnValue(stmt) } };
});

function makeInteraction() {
  return {
    memberPermissions: { has: vi.fn().mockReturnValue(false) },
    options: { getUser: vi.fn().mockReturnValue(null) },
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
    guild: {
      members: { fetch: vi.fn().mockResolvedValue({ roles: { add: vi.fn() } }) },
      roles: { cache: { find: vi.fn().mockReturnValue(undefined) } },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    client: {},
  };
}

describe('/queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies admin when sheet sync fails', async () => {
    vi.mocked(appendToQueue).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./queue.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('⚠️'),
    );
  });

  it('still sends a success reply when sheet sync fails', async () => {
    vi.mocked(appendToQueue).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./queue.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('rejects a player who is already in the game', async () => {
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ id: 1 }) });
    const { default: command } = await import('./queue.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already in the game') }),
    );
  });
});
