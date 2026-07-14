import type Database from 'better-sqlite3';

export function removeFromQueue(db: Database.Database, userId: string): boolean {
  const existing = db.prepare('SELECT id FROM queue WHERE discord_user_id = ?').get(userId);
  if (!existing) return false;
  db.prepare('DELETE FROM queue WHERE discord_user_id = ?').run(userId);
  return true;
}
