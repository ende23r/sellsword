import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArmyByDiscordId, getCommanderByDiscordId } from '../lib/db.js';
import { fetchArmyStats, syncArmySheet } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/db.js', () => ({
  getArmyByDiscordId: vi.fn(),
  getCommanderByDiscordId: vi.fn(),
  default: {},
}));

vi.mock('../lib/sheets.js', () => ({
  extractSheetId: vi.fn((url: string | null | undefined) => url ?? null),
  fetchArmyStats: vi.fn(),
  syncArmySheet: vi.fn(),
}));

vi.mock('../lib/admin-notify.js', () => ({
  notifyAdmin: vi.fn(),
}));

function makeStats(overrides: object = {}) {
  return { supplies: 1000, coin: 0, goods: 0, hex_q: 0, hex_r: 0, ...overrides };
}

function makeInteraction({ resource = 'supplies', amount = 100 } = {}) {
  return {
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
    options: {
      getUser: vi.fn().mockReturnValue({ id: 'user-2', displayName: 'Bob', toString: () => '@Bob' }),
      getString: vi.fn().mockReturnValue(resource),
      getInteger: vi.fn().mockReturnValue(amount),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    client: {},
  };
}

describe('/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getArmyByDiscordId).mockImplementation(
      (id: string) => ({ id: id === 'user-1' ? 1 : 2 }) as never,
    );
    vi.mocked(getCommanderByDiscordId).mockImplementation(
      (id: string) =>
        ({ army_sheet_url: id === 'user-1' ? 'sheet-sender' : 'sheet-recipient' }) as never,
    );
    vi.mocked(fetchArmyStats).mockImplementation(async () => makeStats() as never);
    vi.mocked(syncArmySheet).mockResolvedValue(undefined as never);
  });

  it('moves the amount between both sheets on success', async () => {
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(syncArmySheet).toHaveBeenCalledTimes(2);
    const targets = vi.mocked(syncArmySheet).mock.calls.map((c) => c[0]);
    expect(targets).toEqual(['sheet-sender', 'sheet-recipient']);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('✅'));
  });

  it('rejects when armies are in different hexes', async () => {
    vi.mocked(fetchArmyStats)
      .mockResolvedValueOnce(makeStats({ hex_q: 0 }) as never)
      .mockResolvedValueOnce(makeStats({ hex_q: 5 }) as never);
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(syncArmySheet).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('same hex'));
  });

  it('rejects when the sender lacks the amount', async () => {
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction({ amount: 5000 });
    await command.execute(interaction as never);

    expect(syncArmySheet).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('cannot transfer'));
  });

  it('transfers nothing when the sender sheet write fails', async () => {
    vi.mocked(syncArmySheet).mockImplementation(async (sheetId) => {
      if (sheetId === 'sheet-sender') throw new Error('quota');
    });
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(syncArmySheet).not.toHaveBeenCalledWith('sheet-recipient', expect.anything());
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Nothing was transferred'),
    );
  });

  it('restores the sender and notifies admin when the recipient write fails', async () => {
    vi.mocked(syncArmySheet).mockImplementation(async (sheetId) => {
      if (sheetId === 'sheet-recipient') throw new Error('quota');
    });
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    // deduct, failed credit, restore
    const targets = vi.mocked(syncArmySheet).mock.calls.map((c) => c[0]);
    expect(targets).toEqual(['sheet-sender', 'sheet-recipient', 'sheet-sender']);
    expect(notifyAdmin).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('⚠️'));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('restored'));
  });

  it('flags for manual fix when the restore write also fails', async () => {
    let senderWrites = 0;
    vi.mocked(syncArmySheet).mockImplementation(async (sheetId) => {
      if (sheetId === 'sheet-recipient') throw new Error('quota');
      if (sheetId === 'sheet-sender' && ++senderWrites > 1) throw new Error('quota');
    });
    const { default: command } = await import('./transfer.js');
    const interaction = makeInteraction();
    await command.execute(interaction as never);

    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('manually'),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('⚠️'));
  });
});
