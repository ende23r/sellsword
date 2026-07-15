import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import type { Command } from '../types.js';

const dropMessage: Command = {
  data: new SlashCommandBuilder()
    .setName('drop-message')
    .setDescription('(Admin) Delete an undelivered message by ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o.setName('message_id').setDescription('Message ID').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const messageId = interaction.options.getInteger('message_id', true);

    const row = db
      .prepare(
        `SELECT m.id, m.content, m.delivered,
                sc.discord_user_id AS sender_discord_id,
                rc.discord_user_id AS recipient_discord_id
         FROM messages m
         JOIN commanders sc ON sc.id = m.sender_commander_id
         JOIN commanders rc ON rc.id = m.recipient_commander_id
         WHERE m.id = ?`,
      )
      .get(messageId) as {
      id: number;
      content: string;
      delivered: number;
      sender_discord_id: string;
      recipient_discord_id: string;
    } | undefined;

    if (!row) {
      await interaction.editReply(`No message with ID ${messageId}.`);
      return;
    }

    if (row.delivered) {
      await interaction.editReply(`Message ${messageId} was already delivered and cannot be dropped.`);
      return;
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

    const preview = row.content.length > 60 ? row.content.slice(0, 60) + '…' : row.content;
    await notifyAdmin(
      interaction.client,
      `🗑️ Message ${messageId} dropped (<@${row.sender_discord_id}> → <@${row.recipient_discord_id}>): "${preview}"`,
    );
    await interaction.editReply(
      `✅ Message ${messageId} dropped.\n<@${row.sender_discord_id}> → <@${row.recipient_discord_id}>: "${preview}"`,
    );
  },
};

export default dropMessage;
