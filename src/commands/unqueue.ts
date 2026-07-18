import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { removeFromQueue } from '../lib/queue-ops.js';
import { removeFromQueueSheet } from '../lib/sheets.js';
import type { Command } from '../types.js';

const QUEUE_ROLE_NAME = 'Queued';

const unqueue: Command = {
  data: new SlashCommandBuilder()
    .setName('unqueue')
    .setDescription('Remove yourself from the player queue. Admins can remove any player.')
    .addUserOption((o) =>
      o.setName('player').setDescription('(Admin only) Remove a specific player').setRequired(false),
    ),

  async execute(interaction) {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ?? false;
    const targetUser = interaction.options.getUser('player');

    if (targetUser && !isAdmin) {
      await interaction.reply({
        content: 'Only admins can remove other players from the queue.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = targetUser ?? interaction.user;

    const entry = removeFromQueue(db, user.id);
    if (!entry) {
      await interaction.reply({
        content: `${user.id === interaction.user.id ? 'You are' : `${user.displayName} is`} not in the queue.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Remove the queue role if it exists and the user is still a member
    const guild = interaction.guild!;
    const member = await guild.members.fetch(user.id).catch(() => null);
    const role = guild.roles.cache.find((r) => r.name === QUEUE_ROLE_NAME);
    if (role && member) await member.roles.remove(role);

    // Remove the row from the admin sheet (non-fatal)
    try {
      await removeFromQueueSheet(entry.discord_username);
    } catch (err) {
      console.error('Failed to remove queue row from Google Sheets:', err);
      await notifyAdmin(
        interaction.client,
        `⚠️ Queue sheet sync failed — remove **${entry.discord_username}** manually.`,
      );
    }

    await interaction.reply(
      targetUser
        ? `✅ **${user.username}** has been removed from the queue.`
        : `✅ You've been removed from the queue, **${user.username}**.`,
    );
  },
};

export default unqueue;
