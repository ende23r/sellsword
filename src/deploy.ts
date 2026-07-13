import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { Command } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];
for (const file of readdirSync(join(__dirname, 'commands')).filter((f) => f.endsWith('.ts'))) {
  const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);
  const command: Command = mod.default;
  commands.push(command.data.toJSON());
}

const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APP_ID || !DISCORD_GUILD_ID) {
  throw new Error('Missing required environment variables. Check your .env file.');
}

const rest = new REST().setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID), {
  body: commands,
});

console.log('Slash commands registered.');
