import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockFetchChannel = vi.fn().mockResolvedValue({ isTextBased: () => true, send: mockSend });

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({
        army_name: 'Iron Legion',
        hex_q: 2,
        hex_r: 3,
        faction_name: 'Orange',
      }),
    }),
  },
}));

function makeInteraction() {
  return {
    user: { id: 'user-1', username: 'alice' },
    options: { getString: vi.fn().mockReturnValue('Can I recruit mercenaries?') },
    client: { channels: { fetch: mockFetchChannel } },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/gmping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GM_PING_CHANNEL_ID = 'gm-chan-1';
  });

  afterEach(() => {
    delete process.env.GM_PING_CHANNEL_ID;
  });

  it('posts the player message to the GM channel', async () => {
    const { default: command } = await import('./gmping.js');
    await command.execute(makeInteraction() as any);
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('Can I recruit mercenaries?'));
  });

  it('includes faction and army context in the GM channel post', async () => {
    const { default: command } = await import('./gmping.js');
    await command.execute(makeInteraction() as any);
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('Iron Legion'),
    );
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('Orange'));
  });

  it('replies publicly (non-ephemeral) so GMs can respond', async () => {
    const { default: command } = await import('./gmping.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    const replyArg = vi.mocked(interaction.reply).mock.calls[0][0] as any;
    expect(replyArg.ephemeral).toBeFalsy();
  });

  it('includes the ping content in the reply', async () => {
    const { default: command } = await import('./gmping.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Can I recruit mercenaries?') }),
    );
  });

  it('still replies when GM_PING_CHANNEL_ID is not configured', async () => {
    delete process.env.GM_PING_CHANNEL_ID;
    const { default: command } = await import('./gmping.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('still replies when the player has no army', async () => {
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(null) });
    const { default: command } = await import('./gmping.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining('not in game'));
  });
});
