import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/db.js', () => {
  const stmt = {
    all: vi.fn().mockReturnValue([
      { id: 1, name: 'Iron Legion', discord_user_id: 'user-1' },
      { id: 2, name: 'Golden Horde', discord_user_id: 'user-2' },
    ]),
  };
  return { default: { prepare: vi.fn().mockReturnValue(stmt) } };
});

function makeInteraction() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/list-armies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists all armies with their IDs', async () => {
    const { default: command } = await import('./list-armies.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    const { content } = interaction.reply.mock.calls[0][0] as { content: string };
    expect(content).toContain('1');
    expect(content).toContain('Iron Legion');
    expect(content).toContain('2');
    expect(content).toContain('Golden Horde');
  });

  it('replies with a message when no armies exist', async () => {
    const { default: command } = await import('./list-armies.js');
    const interaction = makeInteraction();
    const db = (await import('../lib/db.js')).default as any;
    db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No armies') }),
    );
  });
});
