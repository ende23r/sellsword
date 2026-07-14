import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { removeFromQueue } from './queue-ops.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE queue (
      id              INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL UNIQUE,
      discord_username TEXT NOT NULL,
      added_at        TEXT NOT NULL DEFAULT (datetime('now')),
      added_by_id     TEXT NOT NULL
    )
  `);
  return db;
}

function seedUser(db: Database.Database, userId = 'user-1', username = 'alice') {
  db.prepare(
    'INSERT INTO queue (discord_user_id, discord_username, added_by_id) VALUES (?, ?, ?)',
  ).run(userId, username, 'admin-1');
}

describe('removeFromQueue', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('removes the user and returns the stored entry', () => {
    seedUser(db);
    const result = removeFromQueue(db, 'user-1');
    expect(result).not.toBeNull();
    expect(result?.discord_username).toBe('alice');
    expect(db.prepare('SELECT * FROM queue WHERE discord_user_id = ?').get('user-1')).toBeUndefined();
  });

  it('returns null when the user is not in the queue', () => {
    expect(removeFromQueue(db, 'not-queued')).toBeNull();
  });

  it('does not affect other users in the queue', () => {
    seedUser(db, 'user-1', 'alice');
    seedUser(db, 'user-2', 'bob');
    removeFromQueue(db, 'user-1');
    expect(db.prepare('SELECT * FROM queue WHERE discord_user_id = ?').get('user-2')).toBeDefined();
  });
});
