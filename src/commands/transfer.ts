import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getCommanderByDiscordId } from '../lib/db.js';
import { extractSheetId, fetchArmyStats, syncArmySheet } from '../lib/sheets.js';
import type { Command } from '../types.js';

type Resource = 'supplies' | 'coin' | 'goods';

const transfer: Command = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Send supplies, goods, or coin to an army in the same hex.')
    .addUserOption((o) =>
      o.setName('recipient').setDescription('The commander to transfer to').setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('resource')
        .setDescription('What to transfer')
        .setRequired(true)
        .addChoices(
          { name: 'Supplies', value: 'supplies' },
          { name: 'Coin', value: 'coin' },
          { name: 'Goods', value: 'goods' },
        ),
    )
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How much to transfer').setRequired(true).setMinValue(1),
    ),

  async execute(interaction) {
    const sender = getArmyByDiscordId(interaction.user.id);
    if (!sender) {
      await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
      return;
    }

    const recipientUser = interaction.options.getUser('recipient', true);
    if (recipientUser.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot transfer to yourself.', flags: MessageFlags.Ephemeral });
      return;
    }

    const recipient = getArmyByDiscordId(recipientUser.id);
    if (!recipient) {
      await interaction.reply({
        content: `${recipientUser.displayName} does not have an army.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sender.hex_q !== recipient.hex_q || sender.hex_r !== recipient.hex_r) {
      await interaction.reply({
        content: `Your army is at (${sender.hex_q},${sender.hex_r}) and theirs is at (${recipient.hex_q},${recipient.hex_r}). Armies must be in the same hex to transfer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const senderCommander = getCommanderByDiscordId(interaction.user.id);
    const recipientCommander = getCommanderByDiscordId(recipientUser.id);
    const senderSheetId = extractSheetId(senderCommander?.army_sheet_url);
    const recipientSheetId = extractSheetId(recipientCommander?.army_sheet_url);

    if (!senderSheetId) {
      await interaction.reply({ content: 'Your army has no sheet configured.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!recipientSheetId) {
      await interaction.reply({ content: "Recipient's army has no sheet configured.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();

    const resource = interaction.options.getString('resource', true) as Resource;
    const amount = interaction.options.getInteger('amount', true);

    const [senderStats, recipientStats] = await Promise.all([
      fetchArmyStats(senderSheetId),
      fetchArmyStats(recipientSheetId),
    ]);

    if (senderStats[resource] < amount) {
      await interaction.editReply(
        `You only have ${senderStats[resource].toLocaleString()} ${resource} — cannot transfer ${amount.toLocaleString()}.`,
      );
      return;
    }

    senderStats[resource] -= amount;
    recipientStats[resource] += amount;

    // Look up hex positions from DB for the sheet sync (hex is display-only in Sheets)
    const senderHex = db.prepare('SELECT hex_q, hex_r FROM armies WHERE id = ?').get(sender.id) as { hex_q: number; hex_r: number };
    const recipientHex = db.prepare('SELECT hex_q, hex_r FROM armies WHERE id = ?').get(recipient.id) as { hex_q: number; hex_r: number };

    await Promise.all([
      syncArmySheet(senderSheetId, senderStats, senderHex.hex_q, senderHex.hex_r),
      syncArmySheet(recipientSheetId, recipientStats, recipientHex.hex_q, recipientHex.hex_r),
    ]);

    await interaction.editReply(
      `✅ Transferred **${amount.toLocaleString()} ${resource}** to ${recipientUser}.`,
    );
  },
};

export default transfer;
