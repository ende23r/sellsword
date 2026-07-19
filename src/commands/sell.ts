import { SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { fetchArmyStats, fetchDemands } from '../lib/sheets.js';
import type { Command } from '../types.js';

const sell: Command = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Rest at market and sell goods matching the local demand, day by day.'),

  async execute(interaction) {
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const { army, sheetId } = player;

    await interaction.deferReply();

    const stats = await fetchArmyStats(sheetId);
    if (stats.goods.length === 0) {
      await interaction.editReply('Your army carries no goods to sell.');
      return;
    }

    const { demands } = await fetchDemands();
    const norm = (name: string) => name.trim().toLowerCase();
    const matching = demands.filter(
      (d) =>
        d.hex_q === stats.hex_q &&
        d.hex_r === stats.hex_r &&
        stats.goods.some((g) => norm(g.name) === norm(d.good) && g.count > 0),
    );

    if (matching.length === 0) {
      await interaction.editReply(
        `No demand at (${stats.hex_q},${stats.hex_r}) matches your goods. The market is elsewhere.`,
      );
      return;
    }

    // One live order at a time: cancel any existing move, forage, or sell order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type IN ('forage', 'move', 'sell', 'siege') AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'sell', '{}')").run(
      army.id,
    );

    const lines = matching.map((d) => {
      const good = stats.goods.find((g) => norm(g.name) === norm(d.good))!;
      return `• **${good.name}** (${good.count.toLocaleString()} held) at ${d.price} coin each, market absorbs ${d.volume.toLocaleString()}/day`;
    });

    await interaction.editReply(
      `✅ Sell order queued — your army rests at market from the next night update, selling each day until its marketable goods are gone.\n` +
        lines.join('\n') +
        `\nOther armies selling the same good here split the daily volume with you.`,
    );
  },
};

export default sell;
