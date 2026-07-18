import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArmyByDiscordId, getCommanderByDiscordId } from './db.js';
import { requirePlayerArmy } from './command-helpers.js';

vi.mock('./db.js', () => ({
  getArmyByDiscordId: vi.fn(),
  getCommanderByDiscordId: vi.fn(),
  default: {},
}));

vi.mock('./sheets.js', () => ({
  extractSheetId: vi.fn((url: string | null | undefined) => (url ? 'sheet-abc' : null)),
}));

function makeInteraction() {
  return {
    user: { id: 'user-1' },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('requirePlayerArmy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replies ephemerally and returns null when the user has no army', async () => {
    vi.mocked(getArmyByDiscordId).mockReturnValue(undefined);
    const interaction = makeInteraction();

    const result = await requirePlayerArmy(interaction as never);

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no army') }),
    );
  });

  it('replies ephemerally and returns null when no sheet is configured', async () => {
    vi.mocked(getArmyByDiscordId).mockReturnValue({ id: 1 } as never);
    vi.mocked(getCommanderByDiscordId).mockReturnValue({ army_sheet_url: null } as never);
    const interaction = makeInteraction();

    const result = await requirePlayerArmy(interaction as never);

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no sheet') }),
    );
  });

  it('returns army, commander, and sheetId when fully configured', async () => {
    vi.mocked(getArmyByDiscordId).mockReturnValue({ id: 1 } as never);
    vi.mocked(getCommanderByDiscordId).mockReturnValue({
      id: 7,
      army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-abc',
    } as never);
    const interaction = makeInteraction();

    const result = await requirePlayerArmy(interaction as never);

    expect(result).toEqual({
      army: { id: 1 },
      commander: expect.objectContaining({ id: 7 }),
      sheetId: 'sheet-abc',
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
