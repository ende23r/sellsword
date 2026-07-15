import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { readFactionSeed, syncFactions } from '../lib/faction-sync.js';
import type { Command } from '../types.js';

const seedFactions: Command = {
  data: new SlashCommandBuilder()
    .setName('seed-factions')
    .setDescription('(Admin) Create missing faction roles and channel categories from faction-seed.json.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await interaction.deferReply();

    const factions = readFactionSeed();
    if (factions.length === 0) {
      await interaction.editReply(
        'No factions found. Copy `faction-seed.example.json` to `faction-seed.json` and fill it in.',
      );
      return;
    }

    const log = await syncFactions(interaction.guild!, db, factions);
    await interaction.editReply(
      `**Faction sync complete** (${factions.length} faction${factions.length === 1 ? '' : 's'})\n` +
      log.map((l) => `• ${l}`).join('\n'),
    );
  },
};

export default seedFactions;
