import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveConferenceChannel = vi.hoisted(() => vi.fn());
const mockGetConferenceChannelForHex = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockGetArmiesAtHex = vi.hoisted(() => vi.fn());
const mockGetArmyByDiscordId = vi.hoisted(() => vi.fn());
const mockGetCommanderByArmyId = vi.hoisted(() => vi.fn());
const mockGetStrongholdAtHex = vi.hoisted(() => vi.fn().mockReturnValue(null));

vi.mock('../lib/db.js', () => ({
  default: {},
  getArmyByDiscordId: mockGetArmyByDiscordId,
  getArmiesAtHex: mockGetArmiesAtHex,
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
    mockGetArmyByDiscordId.mockReturnValue({ id: 1, hex_q: 3, hex_r: 5 });
    mockGetArmiesAtHex.mockReturnValue([
      { id: 1, name: 'Iron Legion' },
      { id: 2, name: 'Black Company' },
    ]);
    mockGetCommanderByArmyId.mockImplementation((id: number) => ({
      id,
      discord_user_id: `user-${id}`,
    }));
    mockChannelCreate.mockResolvedValue(fakeChannel);
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
