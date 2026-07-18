import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logMessage } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';

const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockExtractSheetId = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  logMessage: vi.fn(),
  fetchArmyStats: mockFetchArmyStats,
  extractSheetId: mockExtractSheetId,
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
        id === 'sender-1' ? { id: 1 } : { id: 2 },
      ),
    getCommanderByDiscordId: vi
      .fn()
      .mockImplementation((id: string) =>
        id === 'sender-1'
          ? { id: 1, army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-sender' }
          : { id: 2, army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-recipient' },
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
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractSheetId.mockImplementation((url: string | null) => {
      if (!url) return null;
      const match = url.match(/\/d\/([^/]+)/);
      return match?.[1] ?? null;
    });
    mockFetchArmyStats.mockImplementation((sheetId: string) =>
      Promise.resolve({
        infantry_detachments: [], cavalry_detachments: [], noncombatants: 0,
        morale: 9, resting_morale: 9, max_morale: 12,
        supplies: 0, coin: 0, goods: [],
        stance: 'allow_passage' as const,
        scouting_range: 1,
        forced_march: false, night_march: false,
        hex_q: sheetId === 'sheet-sender' ? 0 : 3,
        hex_r: 0,
      }),
    );
  });

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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('✅'),
    );
  });

  it('uses stats from both sheets to calculate hex distance', async () => {
    const { hexDistance } = await import('../lib/hex.js');
    const { default: command } = await import('./message.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockFetchArmyStats).toHaveBeenCalledTimes(2);
    expect(hexDistance).toHaveBeenCalledWith(
      { q: 0, r: 0 },
      { q: 3, r: 0 },
    );
  });
});
