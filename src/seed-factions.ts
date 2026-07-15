import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import db from './lib/db.js';
import { readFactionSeed, syncFactions } from './lib/faction-sync.js';

const factions = readFactionSeed();
if (factions.length === 0) {
  console.error('No factions found. Copy faction-seed.example.json to faction-seed.json and fill it in.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async (c) => {
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
