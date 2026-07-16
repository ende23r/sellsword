import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDailyUpdate } from '../lib/daily-update.js';

vi.mock('../lib/daily-update.js', () => ({
  runDailyUpdate: vi.fn().mockResolvedValue(undefined),
}));

function makeInteraction(phase: string) {
  return {
    options: { getString: vi.fn().mockReturnValue(phase) },
    client: {
      channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true }) },
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticknow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_CHANNEL_ID = 'chan-admin';
  });

  afterEach(() => {
    delete process.env.ADMIN_CHANNEL_ID;
  });

  it('calls runDailyUpdate with the specified phase', async () => {
    const { default: command } = await import('./ticknow.js');
    const interaction = makeInteraction('morning');
    await command.execute(interaction as any);
    expect(vi.mocked(runDailyUpdate)).toHaveBeenCalledWith('morning', expect.anything());
  });

  it('replies with the phase name on success', async () => {
    const { default: command } = await import('./ticknow.js');
    const interaction = makeInteraction('night');
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('NIGHT'));
  });

  it('replies with error when ADMIN_CHANNEL_ID is not set', async () => {
    delete process.env.ADMIN_CHANNEL_ID;
    const { default: command } = await import('./ticknow.js');
    const interaction = makeInteraction('morning');
    await command.execute(interaction as any);
    expect(vi.mocked(runDailyUpdate)).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('ADMIN_CHANNEL_ID'));
  });

  it('replies with error when admin channel is not text-based', async () => {
    const { default: command } = await import('./ticknow.js');
    const interaction = makeInteraction('noon');
    (interaction.client.channels.fetch as any).mockResolvedValue({ isTextBased: () => false });
    await command.execute(interaction as any);
    expect(vi.mocked(runDailyUpdate)).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('not a text'));
  });

  it('replies with error when runDailyUpdate throws', async () => {
    vi.mocked(runDailyUpdate).mockRejectedValue(new Error('sheet api down'));
    const { default: command } = await import('./ticknow.js');
    const interaction = makeInteraction('morning');
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('sheet api down'));
  });
});
