import { SlashCommandBuilder } from 'discord.js';
import db, { getHex, type HexRow } from '../lib/db.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { hexesInRange } from '../lib/hex.js';
import { fetchArmyStats } from '../lib/sheets.js';
import type { Command } from '../types.js';

const forage: Command = {
  data: new SlashCommandBuilder()
    .setName('forage')
    .setDescription('Order your army to collect supplies from the area at the next night update.'),

  async execute(interaction) {
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const { army, sheetId } = player;

    await interaction.deferReply();

    const armyStats = await fetchArmyStats(sheetId);
    const currentHex = getHex(armyStats.hex_q, armyStats.hex_r);
    if (!currentHex) {
      await interaction.editReply('Your army is on an unknown hex.');
      return;
    }

    const range = armyStats.scouting_range;
    const coords = hexesInRange({ q: armyStats.hex_q, r: armyStats.hex_r }, range);

    let totalYield = 0;
    let exhaustedCount = 0;

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
    }

    // One live order at a time: cancel any existing move or forage order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type IN ('forage', 'move', 'sell') AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'forage', '{}')").run(
      army.id,
    );

    const rangeLabel = range > 1 ? `${range}-hex scouting range (${coords.length} hexes)` : `1-hex range (${coords.length} hexes)`;
    const msg =
      `✅ Forage order queued for the next night update.\n` +
      `**Area:** ${rangeLabel} around (${armyStats.hex_q},${armyStats.hex_r})\n` +
      `**Potential yield:** ${totalYield.toLocaleString()} supplies` +
      (exhaustedCount > 0 ? ` (${exhaustedCount} exhausted hex${exhaustedCount > 1 ? 'es' : ''} skipped)` : '');

    await interaction.editReply(msg);
  },
};

export default forage;
