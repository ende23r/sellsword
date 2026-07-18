import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

const roll: Command = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a die and post the result.')
    .addIntegerOption((o) =>
      o
        .setName('sides')
        .setDescription('Number of sides on the die (e.g. 6 for a d6)')
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(1000),
    ),
  allowInPause: true,

  async execute(interaction) {
    const sides = interaction.options.getInteger('sides', true);
    const result = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`🎲 Rolled a d${sides}: **${result}**`);
  },
};

export default roll;
