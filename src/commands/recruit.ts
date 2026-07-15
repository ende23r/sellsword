import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { upsertFaction } from '../lib/faction-ops.js';
import type { Command, QueueEntry } from '../types.js';

const QUEUE_ROLE_NAME = 'Queued';

const recruit: Command = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('(Admin) Take the top player from the queue and add them to a faction.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption((o) =>
      o.setName('faction').setDescription('The faction role to assign').setRequired(true),
    )
    .addUserOption((o) =>
      o
        .setName('player')
        .setDescription('Override: recruit a specific player instead of queue top')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild!;
    const factionRole = interaction.options.getRole('faction', true);
    const overrideUser = interaction.options.getUser('player');

    let userId: string;
    let username: string;

    if (overrideUser) {
      userId = overrideUser.id;
      username = overrideUser.username;
    } else {
      const top = db.prepare('SELECT * FROM queue ORDER BY added_at ASC LIMIT 1').get() as
        QueueEntry | undefined;
      if (!top) {
        await interaction.editReply('The queue is empty.');
        return;
      }
      userId = top.discord_user_id;
      username = top.discord_username;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await interaction.editReply(`Could not find user ${userId} in this server.`);
      return;
    }

    upsertFaction(db, factionRole.name, factionRole.id);
    await member.roles.add(factionRole.id);
    const queueRole = guild.roles.cache.find((r) => r.name === QUEUE_ROLE_NAME);
    if (queueRole) await member.roles.remove(queueRole);

    db.prepare('DELETE FROM queue WHERE discord_user_id = ?').run(userId);

    await notifyAdmin(
      interaction.client,
      `✅ **${username}** recruited into faction **${factionRole.name}** by ${interaction.user}.`,
    );

    await interaction.editReply(
      `✅ **${username}** has been recruited into **${factionRole.name}**.`,
    );
  },
};

export default recruit;
