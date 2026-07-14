import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { removeFromQueue } from '../lib/queue-ops.js';
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
        ephemeral: true,
      });
      return;
    }

    const user = targetUser ?? interaction.user;

    const removed = removeFromQueue(db, user.id);
    if (!removed) {
      await interaction.reply({
        content: `${user.id === interaction.user.id ? 'You are' : `${user.displayName} is`} not in the queue.`,
        ephemeral: true,
      });
      return;
    }

    // Remove the queue role if it exists
    const guild = interaction.guild!;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find((r) => r.name === QUEUE_ROLE_NAME);
    if (role) await member.roles.remove(role);

    await interaction.reply(
      targetUser
        ? `✅ **${user.username}** has been removed from the queue.`
        : `✅ You've been removed from the queue, **${user.username}**.`,
    );
  },
};

export default unqueue;
