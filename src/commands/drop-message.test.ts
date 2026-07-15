import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/admin-notify.js', () => ({ notifyAdmin: vi.fn() }));

const mockRun = vi.fn();

const pendingRow = {
  id: 7,
  content: 'Retreat immediately to the forest.',
  delivered: 0,
  sender_discord_id: 'user-1',
  recipient_discord_id: 'user-2',
};

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT')) return { get: vi.fn().mockReturnValue(pendingRow) };
      return { run: mockRun };
    }),
  },
}));

function makeInteraction(messageId = 7) {
  return {
    options: { getInteger: vi.fn().mockReturnValue(messageId) },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/drop-message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the message when it exists and is undelivered', async () => {
    const { default: command } = await import('./drop-message.js');
    await command.execute(makeInteraction() as any);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('replies with confirmation including the message ID', async () => {
    const { default: command } = await import('./drop-message.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('7'));
  });

  it('notifies admin', async () => {
    const { default: command } = await import('./drop-message.js');
    await command.execute(makeInteraction() as any);
    expect(notifyAdmin).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('7'));
  });

  it('replies with an error and does not delete when message does not exist', async () => {
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const { default: command } = await import('./drop-message.js');
    const interaction = makeInteraction(99);
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No'));
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('replies with an error and does not delete when message is already delivered', async () => {
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ ...pendingRow, delivered: 1 }) });
    const { default: command } = await import('./drop-message.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already delivered'));
    expect(mockRun).not.toHaveBeenCalled();
  });
});
