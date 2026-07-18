import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchArmyStats = vi.hoisted(() => vi.fn());
const mockExtractSheetId = vi.hoisted(() => vi.fn());

vi.mock('../lib/sheets.js', () => ({
  fetchArmyStats: mockFetchArmyStats,
  extractSheetId: mockExtractSheetId,
}));

const mockSaveConferenceChannel = vi.hoisted(() => vi.fn());
const mockGetConferenceChannelForHex = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockGetArmyByDiscordId = vi.hoisted(() => vi.fn());
const mockGetCommanderByArmyId = vi.hoisted(() => vi.fn());
const mockGetStrongholdAtHex = vi.hoisted(() => vi.fn().mockReturnValue(null));

// Army rows returned by the bulk query (all armies with their sheet URLs)
const allArmiesRows = [
  { id: 1, army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-1' },
  { id: 2, army_sheet_url: 'https://docs.google.com/spreadsheets/d/sheet-2' },
];

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM armies a JOIN commanders')) return { all: vi.fn().mockReturnValue(allArmiesRows) };
      if (sql.includes('FROM armies WHERE id')) return { get: vi.fn().mockImplementation((id: number) => ({ name: id === 1 ? 'Iron Legion' : 'Black Company' })) };
      return { get: vi.fn(), run: vi.fn() };
    }),
  },
  getArmyByDiscordId: mockGetArmyByDiscordId,
  getCommanderByArmyId: mockGetCommanderByArmyId,
  getStrongholdAtHex: mockGetStrongholdAtHex,
  getConferenceChannelForHex: mockGetConferenceChannelForHex,
  saveConferenceChannel: mockSaveConferenceChannel,
}));

const mockChannelCreate = vi.hoisted(() => vi.fn());
const mockChannelFetch = vi.hoisted(() => vi.fn());

function makeGuild(categoryExists = false) {
  const fakeCategory = { id: 'cat-123', name: 'Conferences', type: ChannelType.GuildCategory };
  return {
    roles: { everyone: { id: 'everyone' } },
    channels: {
      cache: {
        find: vi.fn().mockReturnValue(categoryExists ? fakeCategory : undefined),
      },
      create: mockChannelCreate,
      fetch: mockChannelFetch,
    },
    members: {
      fetch: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, user: { id } })),
    },
  };
}

function makeInteraction(overrides: { userId?: string; guild?: object | null } = {}) {
  const guild = overrides.guild === null ? null : (overrides.guild ?? makeGuild());
  return {
    user: { id: overrides.userId ?? 'user-1' },
    guild,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeChannel = {
  id: 'ch-conf-1',
  send: vi.fn().mockResolvedValue(undefined),
  permissionOverwrites: { create: vi.fn().mockResolvedValue(undefined) },
};

describe('/conference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetArmyByDiscordId.mockReturnValue({ id: 1 });
    mockGetCommanderByArmyId.mockImplementation((id: number) => ({
      id,
      discord_user_id: `user-${id}`,
    }));
    mockChannelCreate.mockResolvedValue(fakeChannel);
    mockExtractSheetId.mockImplementation((url: string | null) => {
      if (!url) return null;
      const match = url.match(/\/d\/([^/]+)/);
      return match?.[1] ?? null;
    });
    // Both armies at (3,5)
    mockFetchArmyStats.mockImplementation(() => Promise.resolve({ hex_q: 3, hex_r: 5 }));
  });

  it('replies with error when not in a guild', async () => {
    const { default: command } = await import('./conference.js');
    const interaction = makeInteraction({ guild: null });
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('server') }),
    );
  });

  it('replies with error when user has no army', async () => {
    mockGetArmyByDiscordId.mockReturnValue(undefined);
    const { default: command } = await import('./conference.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no army') }),
    );
  });

  it('creates a category and channel when neither exists', async () => {
    mockChannelCreate
      .mockResolvedValueOnce({ id: 'cat-new', name: 'Conferences' }) // category
      .mockResolvedValueOnce(fakeChannel); // conference channel

    const { default: command } = await import('./conference.js');
    await command.execute(makeInteraction() as any);

    expect(mockChannelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Conferences', type: ChannelType.GuildCategory }),
    );
    expect(mockChannelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conf-3-5', type: ChannelType.GuildText }),
    );
  });

  it('uses stronghold name for channel name when present', async () => {
    mockGetStrongholdAtHex.mockReturnValue({ name: 'Fort Bravia' });
    mockChannelCreate
      .mockResolvedValueOnce({ id: 'cat-new' })
      .mockResolvedValueOnce(fakeChannel);

    const { default: command } = await import('./conference.js');
    await command.execute(makeInteraction() as any);

    expect(mockChannelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conf-fort-bravia' }),
    );
  });

  it('saves the new channel to the DB', async () => {
    mockChannelCreate
      .mockResolvedValueOnce({ id: 'cat-new' })
      .mockResolvedValueOnce(fakeChannel);

    const { default: command } = await import('./conference.js');
    await command.execute(makeInteraction() as any);

    expect(mockSaveConferenceChannel).toHaveBeenCalledWith(3, 5, 'ch-conf-1');
  });

  it('reuses an existing conference channel and adds permissions', async () => {
    mockGetConferenceChannelForHex.mockReturnValue({ discord_channel_id: 'ch-existing' });
    mockChannelFetch.mockResolvedValue(fakeChannel);

    const { default: command } = await import('./conference.js');
    await command.execute(makeInteraction({ guild: makeGuild(true) }) as any);

    expect(mockChannelCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: ChannelType.GuildText }),
    );
    expect(fakeChannel.permissionOverwrites.create).toHaveBeenCalled();
    expect(mockSaveConferenceChannel).not.toHaveBeenCalled();
  });

  it('sends an announcement in the conference channel', async () => {
    mockChannelCreate
      .mockResolvedValueOnce({ id: 'cat-new' })
      .mockResolvedValueOnce(fakeChannel);

    const { default: command } = await import('./conference.js');
    await command.execute(makeInteraction() as any);

    expect(fakeChannel.send).toHaveBeenCalledWith(
      expect.stringContaining('Iron Legion'),
    );
  });

  it('replies with a link to the channel', async () => {
    mockChannelCreate
      .mockResolvedValueOnce({ id: 'cat-new' })
      .mockResolvedValueOnce(fakeChannel);

    const { default: command } = await import('./conference.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('<#ch-conf-1>'),
    );
  });
});
