import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logMessage } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/sheets.js', () => ({
  logMessage: vi.fn(),
}));

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

vi.mock('../lib/db.js', () => {
  const stmt = { run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }) };
  return {
    default: { prepare: vi.fn().mockReturnValue(stmt) },
    getArmyByDiscordId: vi
      .fn()
      .mockImplementation((id: string) =>
        id === 'sender-1'
          ? { hex_q: 0, hex_r: 0, commander_id: 1 }
          : { hex_q: 3, hex_r: 0, commander_id: 2 },
      ),
    getCommanderByDiscordId: vi
      .fn()
      .mockImplementation((id: string) =>
        id === 'sender-1' ? { id: 1 } : { id: 2 },
      ),
  };
});

vi.mock('../lib/hex.js', () => ({
  hexDistance: vi.fn().mockReturnValue(3),
  computeDeliveryTick: vi.fn().mockReturnValue(new Date('2026-07-15T14:00:00Z')),
}));

function makeInteraction() {
  const recipientUser = { id: 'recipient-1', username: 'bob', displayName: 'Bob' };
  return {
    user: { id: 'sender-1', username: 'alice' },
    options: {
      getUser: vi.fn().mockImplementation((key: string) => {
        if (key === 'recipient') return recipientUser;
        return null;
      }),
      getString: vi.fn().mockReturnValue('Hello there!'),
    },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes a sheet-failure warning in the admin notification when logMessage fails', async () => {
    vi.mocked(logMessage).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./message.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('⚠️'),
    );
  });

  it('still sends a success reply when logMessage fails', async () => {
    vi.mocked(logMessage).mockRejectedValue(new Error('Sheets down'));
    const { default: command } = await import('./message.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('✅') }),
    );
  });
});
