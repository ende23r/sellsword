import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';
import { upsertFaction } from '../lib/faction-ops.js';

vi.mock('../lib/admin-notify.js', () => ({ notifyAdmin: vi.fn() }));
vi.mock('../lib/faction-ops.js', () => ({ upsertFaction: vi.fn().mockReturnValue(1) }));

const mockShareSheetPublic = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSyncArmySheet = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/sheets.js', () => ({
  shareSheetPublic: mockShareSheetPublic,
  syncArmySheet: mockSyncArmySheet,
}));

const mockArmyGet = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockCommanderGet = vi.hoisted(() => vi.fn().mockReturnValue({ id: 1 }));
const mockRun = vi.hoisted(() => vi.fn());

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM armies') && sql.includes('JOIN commanders'))
        return { get: mockArmyGet };
      if (sql.includes('FROM commanders'))
        return { get: mockCommanderGet };
      return { run: mockRun };
    }),
  },
}));

const mockCategory = { id: 'cat-1', type: ChannelType.GuildCategory, name: 'Blue' };
const mockChannel = { id: 'ch-1', send: vi.fn().mockResolvedValue(undefined), toString: () => '#army-blue-1st' };
const mockCreateChannel = vi.hoisted(() => vi.fn());

vi.mock('discord.js', async (importActual) => {
  const actual = await importActual<typeof import('discord.js')>();
  return { ...actual };
});

function makeInteraction() {
  return {
    options: {
      getUser: vi.fn().mockReturnValue({ id: 'user-1', username: 'alice' }),
      getRole: vi.fn().mockReturnValue({ id: 'role-1', name: 'Blue' }),
      getString: vi.fn().mockImplementation((key: string) => {
        if (key === 'army_name') return 'Blue 1st';
        if (key === 'sheet_id') return null;
        return null;
      }),
      getInteger: vi.fn().mockReturnValue(0),
    },
    guild: {
      roles: { everyone: { id: 'everyone-role' } },
      channels: {
        cache: { find: vi.fn().mockReturnValue(mockCategory) },
        create: mockCreateChannel,
      },
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/commission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArmyGet.mockReturnValue(null);
    mockCommanderGet.mockReturnValue({ id: 1 });
    mockCreateChannel.mockResolvedValue(mockChannel);
  });

  it('rejects if the player already has an army', async () => {
    mockArmyGet.mockReturnValue({ id: 99 });
    const { default: command } = await import('./commission.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockCreateChannel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('already has an army'),
    );
  });

  it('commissions a player who has no army', async () => {
    const { default: command } = await import('./commission.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockCreateChannel).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('✅'),
    );
  });

  it('shares the sheet publicly when a sheet ID is provided', async () => {
    const { default: command } = await import('./commission.js');
    const interaction = makeInteraction();
    (interaction.options.getString as any).mockImplementation((key: string) => {
      if (key === 'army_name') return 'Blue 1st';
      if (key === 'sheet_id') return 'https://docs.google.com/spreadsheets/d/abc123/edit';
      return null;
    });
    await command.execute(interaction as any);
    expect(mockShareSheetPublic).toHaveBeenCalledWith('abc123');
  });

  it('does not call shareSheetPublic when no sheet is provided', async () => {
    const { default: command } = await import('./commission.js');
    await command.execute(makeInteraction() as any);
    expect(mockShareSheetPublic).not.toHaveBeenCalled();
  });

  it('syncs default stats and starting position to the sheet when commissioned', async () => {
    const { default: command } = await import('./commission.js');
    const interaction = makeInteraction();
    (interaction.options.getString as any).mockImplementation((key: string) => {
      if (key === 'army_name') return 'Blue 1st';
      if (key === 'sheet_id') return 'https://docs.google.com/spreadsheets/d/abc123/edit';
      return null;
    });
    (interaction.options.getInteger as any).mockImplementation((key: string) => {
      if (key === 'start_q') return 4;
      if (key === 'start_r') return -2;
      return 0;
    });
    await command.execute(interaction as any);
    expect(mockSyncArmySheet).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({ morale: 9, resting_morale: 9, stance: 'allow', scouting_range: 1 }),
      4,
      -2,
    );
  });

  it('rejects if no faction category exists', async () => {
    const { default: command } = await import('./commission.js');
    const interaction = makeInteraction();
    (interaction.guild.channels.cache.find as any).mockReturnValue(undefined);
    await command.execute(interaction as any);
    expect(mockCreateChannel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No Discord category'),
    );
  });
});
