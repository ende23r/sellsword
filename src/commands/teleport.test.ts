import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.fn();
const armyRow = { id: 7, name: 'Iron Legion', hex_q: 0, hex_r: 0 };
const hexRow = { q: 3, r: -2 };

let mockArmyGet = vi.fn().mockReturnValue(armyRow);
let mockHexGet = vi.fn().mockReturnValue(hexRow);

vi.mock('../lib/db.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM armies')) return { get: mockArmyGet };
      if (sql.includes('FROM hexes')) return { get: mockHexGet };
      return { run: mockRun };
    }),
  },
}));

function makeInteraction(armyId = 7, q = 3, r = -2) {
  return {
    options: {
      getInteger: vi.fn((name: string) => ({ army_id: armyId, q, r }[name] ?? null)),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/teleport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArmyGet = vi.fn().mockReturnValue(armyRow);
    mockHexGet = vi.fn().mockReturnValue(hexRow);
  });

  it('updates the army hex coordinates in the DB', async () => {
    const { default: command } = await import('./teleport.js');
    await command.execute(makeInteraction() as any);
    expect(mockRun).toHaveBeenCalledWith(3, -2, 7);
  });

  it('replies with the army name and destination coordinates', async () => {
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/Iron Legion/),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/3.*-2|-2.*3/),
    );
  });

  it('replies with error when army ID does not exist', async () => {
    mockArmyGet = vi.fn().mockReturnValue(undefined);
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No army'));
  });

  it('replies with error when destination hex does not exist', async () => {
    mockHexGet = vi.fn().mockReturnValue(undefined);
    const { default: command } = await import('./teleport.js');
    const interaction = makeInteraction();
    await command.execute(interaction as any);
    expect(mockRun).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No hex'));
  });
});
