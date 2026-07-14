import { SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getHex, type HexRow } from '../lib/db.js';
import { hexesInRange } from '../lib/hex.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import type { Command } from '../types.js';

const forage: Command = {
  data: new SlashCommandBuilder()
    .setName('forage')
    .setDescription('Order your army to collect supplies from the area at the next night update.'),

  async execute(interaction) {
    const army = getArmyByDiscordId(interaction.user.id);
    if (!army) {
      await interaction.reply({ content: 'You have no army.', ephemeral: true });
      return;
    }

    const currentHex = getHex(army.hex_q, army.hex_r);
    if (!currentHex) {
      await interaction.reply({ content: 'Your army is on an unknown hex.', ephemeral: true });
      return;
    }

    // Cavalry extends the forage radius to 2 hexes (same as processForage in tick-processors)
    const range = army.cavalry > 0 ? 2 : 1;
    const coords = hexesInRange({ q: army.hex_q, r: army.hex_r }, range);

    let totalYield = 0;
    let exhaustedCount = 0;
    const revoltHexes: HexRow[] = [];

    for (const coord of coords) {
      const hex = db
        .prepare('SELECT * FROM hexes WHERE q = ? AND r = ?')
        .get(coord.q, coord.r) as HexRow | undefined;
      if (!hex) continue;
      if (hex.forage_count >= 5) {
        exhaustedCount++;
        continue;
      }
      totalYield += hex.settlement * 500;
      if (hex.forage_count >= 1) revoltHexes.push(hex);
    }

    // One live order at a time: cancel any existing move or forage order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type IN ('forage', 'move') AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'forage', '{}')").run(
      army.id,
    );

    const rangeLabel = range === 2 ? `2-hex cavalry range (${coords.length} hexes)` : `1-hex range (${coords.length} hexes)`;
    let msg =
      `✅ Forage order queued for the next night update.\n` +
      `**Area:** ${rangeLabel} around (${army.hex_q},${army.hex_r})\n` +
      `**Potential yield:** ${totalYield.toLocaleString()} supplies` +
      (exhaustedCount > 0 ? ` (${exhaustedCount} exhausted hex${exhaustedCount > 1 ? 'es' : ''} skipped)` : '');

    if (revoltHexes.length > 0) {
      msg += `\n\n⚠️ ${revoltHexes.length} hex${revoltHexes.length > 1 ? 'es' : ''} in range ${revoltHexes.length > 1 ? 'have' : 'has'} been foraged before — revolt risk is elevated. Admin has been notified.`;
      await notifyAdmin(
        interaction.client,
        `⚠️ **Revolt risk:** ${interaction.user} queued a forage order. ` +
          `${revoltHexes.map((h) => `(${h.q},${h.r}) foraged ${h.forage_count}×`).join(', ')}. ` +
          `Army: **${army.name ?? army.id}**.`,
      );
    }

    await interaction.reply(msg);
  },
};

export default forage;
