import 'dotenv/config';
import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { startScheduler } from './lib/scheduler.js';
import { checkAdminChannel, runStartupChecks } from './lib/startup-check.js';
import { readFactionSeed, syncFactions } from './lib/faction-sync.js';
import db from './lib/db.js';
import type { Command } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAUSED = process.argv.includes('--paused');
if (PAUSED) console.log('⏸  Bot started in PAUSE MODE — orders and updates are suspended.');

await runStartupChecks();

const commands = new Collection<string, Command>();
for (const file of readdirSync(join(__dirname, 'commands')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
  const command: Command = mod.default;
  commands.set(command.data.name, command);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  await checkAdminChannel(c);

  const guildId = process.env.DISCORD_GUILD_ID;
  const guild = guildId ? c.guilds.cache.get(guildId) : undefined;
  if (guild) {
    const factions = readFactionSeed();
    if (factions.length > 0) await syncFactions(guild, db, factions);
  }

  if (!PAUSED) startScheduler(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  if (PAUSED && !command.allowInPause) {
    await interaction.reply({
      content: '⏸ The game is currently paused. Orders and updates are suspended.',
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = { content: 'Something went wrong.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
