import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ChannelType } from 'discord.js';
import type { Guild } from 'discord.js';
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
): Promise<void> {
  for (const entry of factions) {
    const existingRole = guild.roles.cache.find((r) => r.name === entry.name);
    const role = existingRole ?? (await guild.roles.create({
      name: entry.name,
      ...(entry.color ? { color: entry.color as `#${string}` } : {}),
    }));

    const existingCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === entry.name,
    );
    const category = existingCategory ?? (await guild.channels.create({
      name: entry.name,
      type: ChannelType.GuildCategory,
    }));

    upsertFaction(db, entry.name, role.id, category.id, entry.color, entry.doc_url);
  }
}

export function readFactionSeed(): FactionSeedEntry[] {
  const seedPath = join(dirname(fileURLToPath(import.meta.url)), '../../faction-seed.json');
  if (!existsSync(seedPath)) return [];
  return JSON.parse(readFileSync(seedPath, 'utf-8')) as FactionSeedEntry[];
}
