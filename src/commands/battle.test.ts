import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmin } from '../lib/admin-notify.js';

vi.mock('../lib/admin-notify.js', () => ({ notifyAdmin: vi.fn() }));

const mockResolveBattle = vi.hoisted(() => vi.fn());
vi.mock('../lib/battle.js', () => ({ resolveBattle: mockResolveBattle }));

const mockChannelGet = vi.hoisted(() => vi.fn());
vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn(() => ({ get: mockChannelGet })),
  },
}));

const mockFetchChannel = vi.hoisted(() => vi.fn());

const mockBattleOutcome = {
  sideA: { armyId: 1, name: 'Iron Legion', effectiveStrength: 3400, modifier: 3, roll: 7, total: 10 },
  sideB: { armyId: 2, name: 'Black Company', effectiveStrength: 2300, modifier: -1, roll: 5, total: 4 },
  winner: 'a' as const,
  diff: 6,
  impossible: false,
  victorCasualtyPct: 5,
  loserCasualtyPct: 20,
  victorMoraleDelta: 2,
  loserMoraleDelta: -2,
  attackerPenalty: false,
  captureRoll: 4,
  loserCaptured: false,
  hexQ: 4,
  hexR: -2,
};

function makeInteraction({ armyA = 1, armyB = 2, attackerId = null as number | null } = {}) {
  return {
    options: {
      getInteger: vi.fn().mockImplementation((key: string) => {
        if (key === 'army_a') return armyA;
        if (key === 'army_b') return armyB;
        if (key === 'attacker_id') return attackerId;
        return null;
      }),
    },
    client: { channels: { fetch: mockFetchChannel } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/battle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBattle.mockReturnValue(mockBattleOutcome);
    mockChannelGet.mockReturnValue({ discord_channel_id: 'ch-army-1' });
    mockFetchChannel.mockResolvedValue({
      isTextBased: () => true,
      send: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('is admin-only (ManageChannels permission)', async () => {
    const { default: command } = await import('./battle.js');
    const perms = command.data.default_member_permissions;
    const manageChannels = String(PermissionFlagsBits.ManageChannels);
    expect(perms).toBe(manageChannels);
  });

  it('calls resolveBattle with the correct army IDs and attacker', async () => {
    const { default: command } = await import('./battle.js');
    await command.execute(makeInteraction({ armyA: 3, armyB: 7, attackerId: 7 }) as any);
    expect(mockResolveBattle).toHaveBeenCalledWith(
      expect.anything(), // db
      3,
      7,
      7,
    );
  });

  it('passes null attacker when none specified', async () => {
    const { default: command } = await import('./battle.js');
    await command.execute(makeInteraction({ attackerId: null }) as any);
    expect(mockResolveBattle).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.any(Number),
      null,
    );
  });

  it('replies with error when resolveBattle returns an error', async () => {
    mockResolveBattle.mockReturnValue({ error: 'Armies are not in the same hex.' });
    const { default: command } = await import('./battle.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Armies are not in the same hex.'),
    );
    expect(notifyAdmin).not.toHaveBeenCalled();
  });

  it('notifies admin with battle details on success', async () => {
    const { default: command } = await import('./battle.js');
    await command.execute(makeInteraction() as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Iron Legion'),
    );
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Black Company'),
    );
  });

  it('admin message includes hex coordinates', async () => {
    const { default: command } = await import('./battle.js');
    await command.execute(makeInteraction() as any);
    expect(notifyAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('4,−2'),
    );
  });

  it('posts a summary to each army channel', async () => {
    const mockSendA = vi.fn().mockResolvedValue(undefined);
    const mockSendB = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    mockFetchChannel.mockImplementation(() => {
      callCount++;
      const send = callCount === 1 ? mockSendA : mockSendB;
      return Promise.resolve({ isTextBased: () => true, send });
    });
    mockChannelGet.mockReturnValue({ discord_channel_id: 'ch-1' });

    const { default: command } = await import('./battle.js');
    await command.execute(makeInteraction() as any);
    expect(mockSendA).toHaveBeenCalled();
    expect(mockSendB).toHaveBeenCalled();
  });

  it('skips army channel notification when channel is unavailable', async () => {
    mockChannelGet.mockReturnValue({ discord_channel_id: null });
    const { default: command } = await import('./battle.js');
    const interaction = makeInteraction();
    await expect(command.execute(interaction as any)).resolves.not.toThrow();
  });

  it('replies with confirmation on success', async () => {
    const { default: command } = await import('./battle.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Battle resolved'));
  });
});
