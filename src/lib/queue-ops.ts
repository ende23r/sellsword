import type Database from 'better-sqlite3';

export function removeFromQueue(
  db: Database.Database,
  userId: string,
): { discord_username: string } | null {
  const existing = db
    .prepare('SELECT discord_username FROM queue WHERE discord_user_id = ?')
    .get(userId) as { discord_username: string } | undefined;
  if (!existing) return null;
  db.prepare('DELETE FROM queue WHERE discord_user_id = ?').run(userId);
  return existing;
}
