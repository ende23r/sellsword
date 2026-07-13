import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('echo')
    .setDescription('Echoes your message back')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The message to echo')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_APP_ID || !DISCORD_GUILD_ID) {
  throw new Error('Missing required environment variables. Check your .env file.');
}

const rest = new REST().setToken(DISCORD_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID),
  { body: commands },
);

console.log('Slash commands registered.');
