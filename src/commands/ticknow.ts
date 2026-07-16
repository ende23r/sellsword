import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { TextChannel } from 'discord.js';
import { runDailyUpdate, type UpdatePhase } from '../lib/daily-update.js';
import type { Command } from '../types.js';

const ticknow: Command = {
  allowInPause: true,

  data: new SlashCommandBuilder()
    .setName('ticknow')
    .setDescription('(Admin) Immediately process a tick phase.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('phase')
        .setDescription('Which phase to run')
        .setRequired(true)
        .addChoices(
          { name: 'Morning', value: 'morning' },
          { name: 'Noon', value: 'noon' },
          { name: 'Night', value: 'night' },
        ),
    ),

  async execute(interaction) {
    const phase = interaction.options.getString('phase', true) as UpdatePhase;
    await interaction.deferReply();

    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (!adminChannelId) {
      await interaction.editReply('`ADMIN_CHANNEL_ID` is not configured.');
      return;
    }

    try {
      const channel = await interaction.client.channels.fetch(adminChannelId);
      if (!channel?.isTextBased()) {
        await interaction.editReply('Admin channel is not a text channel.');
        return;
      }
      await runDailyUpdate(phase, channel as TextChannel);
      await interaction.editReply(`✅ **${phase.toUpperCase()}** tick complete.`);
    } catch (err) {
      await interaction.editReply(`⚠️ Tick failed: ${(err as Error).message}`);
    }
  },
};

export default ticknow;
