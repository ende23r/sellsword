import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { upsertFaction } from './faction-ops.js';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(DB_SCHEMA);
  return db;
}

describe('upsertFaction', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('inserts a new faction row and returns its id', () => {
    const id = upsertFaction(db, 'Red', 'role-1');
    expect(id).toBeGreaterThan(0);
    const row = db.prepare('SELECT * FROM factions WHERE id = ?').get(id) as any;
    expect(row.name).toBe('Red');
    expect(row.discord_role_id).toBe('role-1');
    expect(row.discord_category_id).toBeNull();
  });

  it('stores the category id when provided', () => {
    const id = upsertFaction(db, 'Red', 'role-1', 'cat-1');
    const row = db.prepare('SELECT * FROM factions WHERE id = ?').get(id) as any;
    expect(row.discord_category_id).toBe('cat-1');
  });

  it('updates name on conflict', () => {
    upsertFaction(db, 'Old Name', 'role-1');
    const id = upsertFaction(db, 'New Name', 'role-1');
    const row = db.prepare('SELECT * FROM factions WHERE id = ?').get(id) as any;
    expect(row.name).toBe('New Name');
  });

  it('fills in category_id on a subsequent call without overwriting an existing one', () => {
    upsertFaction(db, 'Red', 'role-1');
    upsertFaction(db, 'Red', 'role-1', 'cat-1');
    const row = db.prepare("SELECT * FROM factions WHERE discord_role_id = 'role-1'").get() as any;
    expect(row.discord_category_id).toBe('cat-1');
  });

  it('does not overwrite an existing category_id with null', () => {
    upsertFaction(db, 'Red', 'role-1', 'cat-1');
    upsertFaction(db, 'Red', 'role-1');
    const row = db.prepare("SELECT * FROM factions WHERE discord_role_id = 'role-1'").get() as any;
    expect(row.discord_category_id).toBe('cat-1');
  });

  it('returns the same id on repeated calls', () => {
    const id1 = upsertFaction(db, 'Red', 'role-1');
    const id2 = upsertFaction(db, 'Red', 'role-1');
    expect(id1).toBe(id2);
  });
});
