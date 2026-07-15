import type Database from 'better-sqlite3';

export function upsertFaction(
  db: Database.Database,
  name: string,
  discordRoleId: string,
  discordCategoryId?: string,
): number {
  db.prepare(
    `INSERT INTO factions (name, discord_role_id, discord_category_id)
     VALUES (?, ?, ?)
     ON CONFLICT(discord_role_id) DO UPDATE SET
       name = excluded.name,
       discord_category_id = COALESCE(excluded.discord_category_id, factions.discord_category_id)`,
  ).run(name, discordRoleId, discordCategoryId ?? null);

  const row = db
    .prepare('SELECT id FROM factions WHERE discord_role_id = ?')
    .get(discordRoleId) as { id: number };
  return row.id;
}
