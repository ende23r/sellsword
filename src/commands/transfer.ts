import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId } from '../lib/db.js';
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

    const resource = interaction.options.getString('resource', true) as Resource;
    const amount = interaction.options.getInteger('amount', true);

    if (sender[resource] < amount) {
      await interaction.reply({
        content: `You only have ${sender[resource].toLocaleString()} ${resource} — cannot transfer ${amount.toLocaleString()}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    db.prepare(`UPDATE armies SET ${resource} = ${resource} - ? WHERE id = ?`).run(
      amount,
      sender.id,
    );
    db.prepare(`UPDATE armies SET ${resource} = ${resource} + ? WHERE id = ?`).run(
      amount,
      recipient.id,
    );

    await interaction.reply(
      `✅ Transferred **${amount.toLocaleString()} ${resource}** to ${recipientUser}.`,
    );
  },
};

export default transfer;
