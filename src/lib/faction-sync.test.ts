import Database from 'better-sqlite3';
import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { syncFactions, type FactionSeedEntry } from './faction-sync.js';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DB_SCHEMA);
  return db;
}

const createRole = vi.fn();
const createChannel = vi.fn();

function makeGuild({
  existingRoles = [] as { id: string; name: string }[],
  existingCategories = [] as { id: string; name: string; type: number }[],
} = {}) {
  createRole.mockResolvedValue({ id: 'new-role-id', name: 'Red' });
  createChannel.mockResolvedValue({ id: 'new-cat-id', name: 'Red' });
  return {
    roles: {
      cache: { find: (fn: (r: { id: string; name: string }) => boolean) => existingRoles.find(fn) },
      create: createRole,
    },
    channels: {
      cache: {
        find: (fn: (c: { id: string; name: string; type: number }) => boolean) =>
          existingCategories.find(fn),
      },
      create: createChannel,
    },
  };
}

const seed: FactionSeedEntry[] = [
  { name: 'Red', color: '#FF0000', doc_url: 'https://example.com/red' },
];

describe('syncFactions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  it('creates a Discord role when none exists', async () => {
    await syncFactions(makeGuild() as any, db, seed);
    expect(createRole).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Red', colors: { primaryColor: '#FF0000' } }),
    );
  });

  it('does not create a role when one already exists', async () => {
    const guild = makeGuild({ existingRoles: [{ id: 'role-1', name: 'Red' }] });
    await syncFactions(guild as any, db, seed);
    expect(createRole).not.toHaveBeenCalled();
  });

  it('creates a channel category when none exists', async () => {
    await syncFactions(makeGuild() as any, db, seed);
    expect(createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Red', type: ChannelType.GuildCategory }),
    );
  });

  it('does not create a category when one already exists', async () => {
    const guild = makeGuild({
      existingCategories: [{ id: 'cat-1', name: 'Red', type: ChannelType.GuildCategory }],
    });
    await syncFactions(guild as any, db, seed);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it('upserts the faction into the DB with role and category IDs', async () => {
    await syncFactions(makeGuild() as any, db, seed);
    const row = db.prepare("SELECT * FROM factions WHERE name = 'Red'").get() as any;
    expect(row).toBeTruthy();
    expect(row.discord_role_id).toBe('new-role-id');
    expect(row.discord_category_id).toBe('new-cat-id');
    expect(row.color).toBe('#FF0000');
    expect(row.doc_url).toBe('https://example.com/red');
  });

  it('uses existing Discord IDs when role and category are already present', async () => {
    const guild = makeGuild({
      existingRoles: [{ id: 'existing-role', name: 'Red' }],
      existingCategories: [{ id: 'existing-cat', name: 'Red', type: ChannelType.GuildCategory }],
    });
    await syncFactions(guild as any, db, seed);
    const row = db.prepare("SELECT * FROM factions WHERE name = 'Red'").get() as any;
    expect(row.discord_role_id).toBe('existing-role');
    expect(row.discord_category_id).toBe('existing-cat');
  });

  it('handles an empty seed list without error', async () => {
    await expect(syncFactions(makeGuild() as any, db, [])).resolves.not.toThrow();
  });
});
