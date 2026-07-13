import { SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId } from '../lib/db.js';
import type { Command } from '../types.js';

const stance: Command = {
  data: new SlashCommandBuilder()
    .setName('stance')
    .setDescription('Set whether your army blocks or allows passage through its hex.')
    .addStringOption((o) =>
      o
        .setName('posture')
        .setDescription('block: deny passage; allow: let armies through')
        .setRequired(true)
        .addChoices(
          { name: 'Allow passage', value: 'allow' },
          { name: 'Block passage', value: 'block' },
        ),
    ),

  async execute(interaction) {
    const army = getArmyByDiscordId(interaction.user.id);
    if (!army) {
      await interaction.reply({ content: 'You have no army.', ephemeral: true });
      return;
    }

    const posture = interaction.options.getString('posture', true) as 'allow' | 'block';
    db.prepare('UPDATE armies SET stance = ? WHERE id = ?').run(posture, army.id);

    await interaction.reply(
      posture === 'block'
        ? '✅ Stance set to **block**. Your army will deny passage to armies that enter your hex.'
        : '✅ Stance set to **allow**. Your army will permit passage through its hex.',
    );
  },
};

export default stance;
