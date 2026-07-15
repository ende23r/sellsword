import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { GuildChannel } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import type { Command } from '../types.js';

const retire: Command = {
  data: new SlashCommandBuilder()
    .setName('retire')
    .setDescription('(Admin) Remove a commander from play: revoke faction role and channel access.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addUserOption((o) =>
      o.setName('commander').setDescription('The player to retire').setRequired(true),
    )
    .addRoleOption((o) =>
      o.setName('faction').setDescription('Their faction role to remove').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild!;
    const commanderUser = interaction.options.getUser('commander', true);
    const factionRole = interaction.options.getRole('faction', true);

    const member = await guild.members.fetch(commanderUser.id);

    if (member.roles.cache.has(factionRole.id)) {
      await member.roles.remove(factionRole as Parameters<typeof member.roles.remove>[0]);
    }

    const commander = db
      .prepare('SELECT discord_channel_id FROM commanders WHERE discord_user_id = ?')
      .get(commanderUser.id) as { discord_channel_id: string | null } | undefined;

    let channelMention = '';
    if (commander?.discord_channel_id) {
      const channel = guild.channels.cache.get(commander.discord_channel_id);
      if (channel?.isTextBased()) {
        await (channel as GuildChannel).permissionOverwrites.delete(commanderUser.id);
        channelMention = ` | Channel: ${channel}`;
      }
    }

    await notifyAdmin(
      interaction.client,
      `🏳️ **${commanderUser.username}** retired from **${factionRole.name}**${channelMention}`,
    );

    await interaction.editReply(
      `✅ **${commanderUser.username}** retired. Faction role removed${channelMention ? ' and channel access revoked' : ''}.`,
    );
  },
};

export default retire;
