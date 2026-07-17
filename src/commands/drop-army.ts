import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { GuildChannel } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import type { Command } from '../types.js';

const dropArmy: Command = {
  data: new SlashCommandBuilder()
    .setName('drop-army')
    .setDescription('(Admin) Remove an army from play and archive its channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o.setName('army_id').setDescription('Army ID (from /list-armies)').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const armyId = interaction.options.getInteger('army_id', true);
    const guild = interaction.guild!;

    const row = db.prepare(
      `SELECT a.id, a.name, c.discord_channel_id
       FROM armies a
       JOIN commanders c ON c.id = a.commander_id
       WHERE a.id = ?`,
    ).get(armyId) as { id: number; name: string; discord_channel_id: string | null } | undefined;

    if (!row) {
      await interaction.editReply(`No army with ID ${armyId}.`);
      return;
    }

    db.prepare('DELETE FROM orders WHERE army_id = ?').run(armyId);
    db.prepare('DELETE FROM detachments WHERE army_id = ?').run(armyId);
    db.prepare('DELETE FROM armies WHERE id = ?').run(armyId);

    let channelNote = '';
    if (row.discord_channel_id) {
      const channel = guild.channels.cache.get(row.discord_channel_id);
      if (channel?.isTextBased()) {
        const existingArchive = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === 'Archived',
        );
        const archiveCategory = existingArchive ?? (await guild.channels.create({
          name: 'Archived',
          type: ChannelType.GuildCategory,
        }));
        await (channel as GuildChannel).setParent(archiveCategory.id, { lockPermissions: false });
        channelNote = ' Channel moved to Archived.';
      }
    }

    await notifyAdmin(
      interaction.client,
      `💀 **${row.name}** (ID: ${armyId}) dispersed.${channelNote}`,
    );
    await interaction.editReply(`✅ **${row.name}** dispersed.${channelNote}`);
  },
};

export default dropArmy;
