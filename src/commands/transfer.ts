import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getArmyByDiscordId, getCommanderByDiscordId } from '../lib/db.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { extractSheetId, fetchArmyStats, syncArmySheet } from '../lib/sheets.js';
import { notifyAdmin } from '../lib/admin-notify.js';
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
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const senderSheetId = player.sheetId;

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

    const recipientCommander = getCommanderByDiscordId(recipientUser.id);
    const recipientSheetId = extractSheetId(recipientCommander?.army_sheet_url);
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

    if (senderStats.hex_q !== recipientStats.hex_q || senderStats.hex_r !== recipientStats.hex_r) {
      await interaction.editReply(
        `Your army is at (${senderStats.hex_q},${senderStats.hex_r}) and theirs is at (${recipientStats.hex_q},${recipientStats.hex_r}). Armies must be in the same hex to transfer.`,
      );
      return;
    }

    if (senderStats[resource] < amount) {
      await interaction.editReply(
        `You only have ${senderStats[resource].toLocaleString()} ${resource} — cannot transfer ${amount.toLocaleString()}.`,
      );
      return;
    }

    senderStats[resource] -= amount;
    recipientStats[resource] += amount;

    // Write sequentially, deducting first, so a sheet failure can never create resources.
    try {
      await syncArmySheet(senderSheetId, senderStats);
    } catch {
      await interaction.editReply(
        '⚠️ Transfer failed — could not update your army sheet. Nothing was transferred.',
      );
      return;
    }

    try {
      await syncArmySheet(recipientSheetId, recipientStats);
    } catch {
      senderStats[resource] += amount;
      let restored = true;
      try {
        await syncArmySheet(senderSheetId, senderStats);
      } catch {
        restored = false;
      }
      await notifyAdmin(
        interaction.client,
        `⚠️ /transfer failed midway: **${amount.toLocaleString()} ${resource}** was deducted from **${interaction.user.username}** but not credited to **${recipientUser.username}**. ` +
          (restored
            ? 'Sender sheet was restored.'
            : 'Sender sheet could NOT be restored — fix both sheets manually.'),
      );
      await interaction.editReply(
        restored
          ? "⚠️ Transfer failed — the recipient's sheet could not be updated. Your resources were restored."
          : '⚠️ Transfer failed midway and your sheet could not be restored. The GM has been notified.',
      );
      return;
    }

    await interaction.editReply(
      `✅ Transferred **${amount.toLocaleString()} ${resource}** to ${recipientUser}.`,
    );
  },
};

export default transfer;
