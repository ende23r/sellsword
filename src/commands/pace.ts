import { SlashCommandBuilder } from 'discord.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { writePace } from '../lib/sheets.js';
import type { Command } from '../types.js';

const pace: Command = {
  data: new SlashCommandBuilder()
    .setName('pace')
    .setDescription("Set your army's march pace.")
    .addBooleanOption((o) =>
      o
        .setName('forced_march')
        .setDescription('Enable forced march (+50% speed, daily morale check)')
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName('night_march')
        .setDescription('Enable night marching (extra 6 miles/day, morale check)')
        .setRequired(true),
    ),

  async execute(interaction) {
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const { sheetId } = player;

    const forced = interaction.options.getBoolean('forced_march', true);
    const night = interaction.options.getBoolean('night_march', true);

    await writePace(sheetId, forced, night);

    const flags = [forced && '**forced march**', night && '**night march**'].filter(Boolean);
    const summary = flags.length > 0 ? flags.join(' + ') : '**standard pace**';

    await interaction.reply(
      `✅ March pace updated: ${summary}.\n${forced ? '⚠️ Daily morale checks apply.' : ''}${night ? '\n⚠️ Night march incurs daily morale checks and risk of wrong turns on forked roads.' : ''}`,
    );
  },
};

export default pace;
