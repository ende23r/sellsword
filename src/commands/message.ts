import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getCommanderByDiscordId } from '../lib/db.js';
import { computeDeliveryTick, hexDistance } from '../lib/hex.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { extractSheetId, fetchArmyStats, logMessage } from '../lib/sheets.js';
import type { Command } from '../types.js';

const message: Command = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send an in-game message to another commander.')
    .addUserOption((o) =>
      o.setName('recipient').setDescription('The commander to message').setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('content')
        .setDescription('The message content')
        .setRequired(true)
        .setMaxLength(1000),
    ),

  async execute(interaction) {
    const senderArmy = getArmyByDiscordId(interaction.user.id);
    const senderCommander = getCommanderByDiscordId(interaction.user.id);
    if (!senderArmy || !senderCommander) {
      await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
      return;
    }

    const recipientUser = interaction.options.getUser('recipient', true);
    if (recipientUser.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot message yourself.', flags: MessageFlags.Ephemeral });
      return;
    }

    const recipientArmy = getArmyByDiscordId(recipientUser.id);
    const recipientCommander = getCommanderByDiscordId(recipientUser.id);
    if (!recipientArmy || !recipientCommander) {
      await interaction.reply({
        content: `${recipientUser.displayName} has no army.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const senderSheetId = extractSheetId(senderCommander.army_sheet_url);
    const recipientSheetId = extractSheetId(recipientCommander.army_sheet_url);

    await interaction.deferReply();

    const content = interaction.options.getString('content', true);

    let dist = 0;
    if (senderSheetId && recipientSheetId) {
      try {
        const [senderStats, recipientStats] = await Promise.all([
          fetchArmyStats(senderSheetId),
          fetchArmyStats(recipientSheetId),
        ]);
        dist = hexDistance(
          { q: senderStats.hex_q, r: senderStats.hex_r },
          { q: recipientStats.hex_q, r: recipientStats.hex_r },
        );
      } catch {
        // Non-fatal: fall back to 0-distance delivery
      }
    }

    const deliverAt = computeDeliveryTick(dist, new Date()).toISOString();

    const { lastInsertRowid } = db.prepare(
      `INSERT INTO messages (sender_commander_id, recipient_commander_id, content, delivers_at)
       VALUES (?, ?, ?, ?)`,
    ).run(senderCommander.id, recipientCommander.id, content, deliverAt);
    const messageId = Number(lastInsertRowid);

    const timestamp = new Date().toISOString();
    let sheetOk = true;
    try {
      await logMessage(
        messageId,
        interaction.user.username,
        recipientUser.username,
        content,
        deliverAt,
        timestamp,
      );
    } catch (err) {
      sheetOk = false;
      console.error('Failed to log message to Google Sheets:', err);
    }

    await notifyAdmin(
      interaction.client,
      `📨 **${interaction.user.username}** → **${recipientUser.username}** | Distance: ${dist} hexes (${dist * 6} miles) | Delivers: <t:${Math.floor(new Date(deliverAt).getTime() / 1000)}:R>\n> ${content}${sheetOk ? '' : '\n⚠️ Sheet logging failed — log this message manually.'}`,
    );

    const deliveryTs = Math.floor(new Date(deliverAt).getTime() / 1000);
    await interaction.editReply(
      `✅ Message dispatched.\n**Recipient:** ${recipientUser}\n**Distance:** ${dist} hexes (${dist * 6} miles)\n**Estimated delivery:** <t:${deliveryTs}:f> (<t:${deliveryTs}:R>)`,
    );
  },
};

export default message;
