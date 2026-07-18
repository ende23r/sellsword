import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArmyByDiscordId } from '../lib/db.js';
import { writePace } from '../lib/sheets.js';

vi.mock('../lib/sheets.js', () => ({
  writePace: vi.fn(),
  extractSheetId: vi.fn().mockReturnValue('sheet-abc'),
}));

vi.mock('../lib/db.js', () => ({
  default: {},
  getArmyByDiscordId: vi.fn().mockReturnValue({ id: 1 }),
  getCommanderByDiscordId: vi
    .fn()
    .mockReturnValue({ army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc' }),
}));

function makeInteraction(forced: boolean, night: boolean) {
  return {
    user: { id: 'user-1' },
    options: {
      getBoolean: vi.fn().mockImplementation((key: string) =>
        key === 'forced_march' ? forced : night,
      ),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/pace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getArmyByDiscordId).mockReturnValue({ id: 1 } as never);
  });

  it('writes the pace to the sheet and confirms', async () => {
    const { default: command } = await import('./pace.js');
    const interaction = makeInteraction(true, false);
    await command.execute(interaction as never);

    expect(writePace).toHaveBeenCalledWith('sheet-abc', true, false);
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('forced march'));
  });

  it('reports standard pace when both flags are off', async () => {
    const { default: command } = await import('./pace.js');
    const interaction = makeInteraction(false, false);
    await command.execute(interaction as never);

    expect(writePace).toHaveBeenCalledWith('sheet-abc', false, false);
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('standard pace'));
  });

  it('rejects users with no army', async () => {
    vi.mocked(getArmyByDiscordId).mockReturnValue(undefined as never);
    const { default: command } = await import('./pace.js');
    const interaction = makeInteraction(false, false);
    await command.execute(interaction as never);

    expect(writePace).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no army') }),
    );
  });
});
