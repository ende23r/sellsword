import { SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getHex } from '../lib/db.js';
import type { Command } from '../types.js';

const forage: Command = {
  data: new SlashCommandBuilder()
    .setName('forage')
    .setDescription('Order your army to forage at the next morning update.'),

  async execute(interaction) {
    const army = getArmyByDiscordId(interaction.user.id);
    if (!army) {
      await interaction.reply({ content: 'You have no army.', ephemeral: true });
      return;
    }

    const hex = getHex(army.hex_q, army.hex_r);
    if (!hex) {
      await interaction.reply({ content: 'Your army is on an unknown hex.', ephemeral: true });
      return;
    }

    if (hex.forage_count >= 5) {
      await interaction.reply({
        content: `Hex (${hex.q},${hex.r}) has been foraged out and cannot be foraged again until spring.`,
        ephemeral: true,
      });
      return;
    }

    // Cancel any existing forage order for this army
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type = 'forage' AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'forage', '{}')").run(
      army.id,
    );

    const potentialYield = hex.settlement * 500;
    const revoltRisk = hex.forage_count >= 3;

    let msg = `✅ Forage order queued for the next morning update.\n**Hex:** (${hex.q},${hex.r}) — settlement ${hex.settlement} — potential yield **${potentialYield.toLocaleString()} supplies**\n**Times foraged this season:** ${hex.forage_count}/5`;

    if (revoltRisk) {
      msg += `\n\n⚠️ This hex has been foraged ${hex.forage_count} times — revolt risk is elevated. Admin has been notified.`;
      await notifyAdmin(interaction, army, hex);
    }

    await interaction.reply(msg);
  },
};

async function notifyAdmin(
  interaction: import('discord.js').ChatInputCommandInteraction,
  army: import('../lib/db.js').ArmyRow,
  hex: import('../lib/db.js').HexRow,
): Promise<void> {
  const adminChannelId = process.env.ADMIN_CHANNEL_ID;
  if (!adminChannelId) return;
  try {
    const channel = await interaction.client.channels.fetch(adminChannelId);
    if (channel?.isTextBased()) {
      await (channel as import('discord.js').TextChannel).send(
        `⚠️ **Revolt risk:** ${interaction.user} queued a forage order on hex (${hex.q},${hex.r}), which has been foraged ${hex.forage_count} times this season. Army: **${army.name ?? army.id}**.`,
      );
    }
  } catch {
    // Admin channel notification failure is non-fatal
  }
}

export default forage;
