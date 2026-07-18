import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArmyByDiscordId } from '../lib/db.js';
import { writeStance } from '../lib/sheets.js';

vi.mock('../lib/sheets.js', () => ({
  writeStance: vi.fn(),
  extractSheetId: vi.fn().mockReturnValue('sheet-abc'),
}));

vi.mock('../lib/db.js', () => ({
  default: {},
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi
    .fn()
    .mockReturnValue({ army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' }),
}));

function makeInteraction(posture: string) {
  return {
    user: { id: 'user-1' },
    options: { getString: vi.fn().mockReturnValue(posture) },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/stance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getArmyByDiscordId).mockReturnValue({ id: 1 } as never);
  });

  it('writes engage stance to the sheet', async () => {
    const { default: command } = await import('./stance.js');
    const interaction = makeInteraction('engage');
    await command.execute(interaction as never);

    expect(writeStance).toHaveBeenCalledWith('sheet-abc', 'engage');
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('intercept'));
  });

  it('writes allow_passage stance to the sheet', async () => {
    const { default: command } = await import('./stance.js');
    const interaction = makeInteraction('allow_passage');
    await command.execute(interaction as never);

    expect(writeStance).toHaveBeenCalledWith('sheet-abc', 'allow_passage');
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('allow passage'));
  });

  it('rejects users with no army', async () => {
    vi.mocked(getArmyByDiscordId).mockReturnValue(undefined as never);
    const { default: command } = await import('./stance.js');
    const interaction = makeInteraction('engage');
    await command.execute(interaction as never);

    expect(writeStance).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no army') }),
    );
  });
});
