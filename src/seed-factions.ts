import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import db from './lib/db.js';
import { syncFactions, type FactionSeedEntry } from './lib/faction-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pathArg = process.argv[2];
const seedPath = pathArg ? resolve(pathArg) : join(__dirname, '../faction-seed.json');

let raw: string;
try {
  raw = readFileSync(seedPath, 'utf-8');
} catch {
  console.error(`Seed file not found: ${seedPath}`);
  if (!pathArg) console.error('Copy faction-seed.example.json to faction-seed.json and fill it in.');
  process.exit(1);
}

const factions: FactionSeedEntry[] = JSON.parse(raw!);
if (factions.length === 0) {
  console.error('No factions in seed file.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  const guild = c.guilds.cache.get(process.env.DISCORD_GUILD_ID ?? '');
  if (!guild) {
    console.error('Guild not found. Check DISCORD_GUILD_ID in .env.');
    await client.destroy();
    process.exit(1);
  }

  const log = await syncFactions(guild, db, factions);
  log.forEach((line) => console.log(line));
  console.log(`Done. ${factions.length} faction(s) synced.`);

  await client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
