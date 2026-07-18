import { SlashCommandBuilder } from 'discord.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { writeStance } from '../lib/sheets.js';
import type { Command } from '../types.js';

const stance: Command = {
  data: new SlashCommandBuilder()
    .setName('stance')
    .setDescription('Set how your army responds to enemies entering its hex.')
    .addStringOption((o) =>
      o
        .setName('posture')
        .setDescription('allow_passage: let armies through; engage: intercept enemies')
        .setRequired(true)
        .addChoices(
          { name: 'Allow passage', value: 'allow_passage' },
          { name: 'Engage', value: 'engage' },
        ),
    ),

  async execute(interaction) {
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const { sheetId } = player;

    const posture = interaction.options.getString('posture', true) as 'allow_passage' | 'engage';
    await writeStance(sheetId, posture);

    await interaction.reply(
      posture === 'engage'
        ? '✅ Stance set to **engage**. Your army will intercept enemies that enter your hex and halt their movement.'
        : '✅ Stance set to **allow passage**. Your army will permit armies to pass through its hex.',
    );
  },
};

export default stance;
