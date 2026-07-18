import { afterEach, describe, expect, it, vi } from 'vitest';

function makeInteraction(sides: number) {
  return {
    options: { getInteger: vi.fn().mockReturnValue(sides) },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/roll', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rolls the minimum face when the RNG bottoms out', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { default: command } = await import('./roll.js');
    const interaction = makeInteraction(6);
    await command.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('**1**'));
  });

  it('rolls the maximum face when the RNG tops out', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const { default: command } = await import('./roll.js');
    const interaction = makeInteraction(6);
    await command.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('**6**'));
  });

  it('names the die being rolled', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { default: command } = await import('./roll.js');
    const interaction = makeInteraction(20);
    await command.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('d20'));
  });

  it('always lands within 1..sides', async () => {
    const { default: command } = await import('./roll.js');
    for (let i = 0; i < 50; i++) {
      const interaction = makeInteraction(6);
      await command.execute(interaction as never);
      const msg = (interaction.reply.mock.calls[0][0] as string).match(/\*\*(\d+)\*\*/);
      const value = Number(msg![1]);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });
});
