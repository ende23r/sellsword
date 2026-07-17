import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getArmyByDiscordId, getCommanderByDiscordId } from '../lib/db.js';
import { extractSheetId, writeStance } from '../lib/sheets.js';
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
      await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
      return;
    }

    const commander = getCommanderByDiscordId(interaction.user.id);
    const sheetId = extractSheetId(commander?.army_sheet_url);
    if (!sheetId) {
      await interaction.reply({ content: 'Your army has no sheet configured.', flags: MessageFlags.Ephemeral });
      return;
    }

    const posture = interaction.options.getString('posture', true) as 'allow' | 'block';
    await writeStance(sheetId, posture);

    await interaction.reply(
      posture === 'block'
        ? '✅ Stance set to **block**. Your army will deny passage to armies that enter your hex.'
        : '✅ Stance set to **allow**. Your army will permit passage through its hex.',
    );
  },
};

export default stance;
