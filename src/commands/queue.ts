import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { appendToQueue } from '../lib/sheets.js';
import type { Command } from '../types.js';

const QUEUE_ROLE_NAME = 'Queued';

const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Join the player queue. Admins can queue any user.')
    .addUserOption((o) =>
      o.setName('player').setDescription('(Admin only) Queue a specific player').setRequired(false),
    ),

  async execute(interaction) {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ?? false;
    const targetUser = interaction.options.getUser('player');

    if (targetUser && !isAdmin) {
      await interaction.reply({
        content: 'Only admins can queue other players.',
        ephemeral: true,
      });
      return;
    }

    const user = targetUser ?? interaction.user;

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM queue WHERE discord_user_id = ?').get(user.id);
    if (existing) {
      await interaction.reply({
        content: `${user.id === interaction.user.id ? 'You are' : `${user.displayName} is`} already in the queue.`,
        ephemeral: true,
      });
      return;
    }

    db.prepare(
      'INSERT INTO queue (discord_user_id, discord_username, added_by_id) VALUES (?, ?, ?)',
    ).run(user.id, user.username, interaction.user.id);

    // Assign queue role if it exists in the guild
    const guild = interaction.guild!;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find((r) => r.name === QUEUE_ROLE_NAME);
    if (role) await member.roles.add(role);

    const timestamp = new Date().toISOString();
    try {
      await appendToQueue(user.username, interaction.user.username, timestamp);
    } catch (err) {
      console.error('Failed to log queue entry to Google Sheets:', err);
      await notifyAdmin(
        interaction.client,
        `⚠️ Queue sheet sync failed — add **${user.username}** manually.`,
      );
    }

    await interaction.reply(
      targetUser
        ? `✅ **${user.username}** has been added to the queue.`
        : `✅ You've joined the queue, **${user.username}**!`,
    );
  },
};

export default queue;
