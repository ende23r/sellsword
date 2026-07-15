import { ChannelType } from 'discord.js';
import type { ColorResolvable, Guild } from 'discord.js';
import type Database from 'better-sqlite3';
import { upsertFaction } from './faction-ops.js';

export type FactionSeedEntry = {
  name: string;
  color?: string;
  doc_url?: string;
};

export async function syncFactions(
  guild: Guild,
  db: Database.Database,
  factions: FactionSeedEntry[],
): Promise<string[]> {
  const log: string[] = [];
  for (const entry of factions) {
    const existingRole = guild.roles.cache.find((r) => r.name === entry.name);
    const role = existingRole ?? (await guild.roles.create({
      name: entry.name,
      ...(entry.color ? { colors: { primaryColor: entry.color as ColorResolvable } } : {}),
    }));
    log.push(existingRole ? `Found role: ${entry.name}` : `Created role: ${entry.name}`);

    const existingCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === entry.name,
    );
    const category = existingCategory ?? (await guild.channels.create({
      name: entry.name,
      type: ChannelType.GuildCategory,
    }));
    log.push(existingCategory ? `Found category: ${entry.name}` : `Created category: ${entry.name}`);

    upsertFaction(db, entry.name, role.id, category.id, entry.color, entry.doc_url);
  }
  return log;
}

