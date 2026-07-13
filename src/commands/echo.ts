import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

const echo: Command = {
  data: new SlashCommandBuilder()
    .setName('echo')
    .setDescription('Echoes your message back')
    .addStringOption((option) =>
      option.setName('message').setDescription('The message to echo').setRequired(true),
    ),

  async execute(interaction) {
    const message = interaction.options.getString('message', true);
    console.log(`[echo] ${interaction.user.tag}: ${message}`);
    await interaction.reply(message);
  },
};

export default echo;
