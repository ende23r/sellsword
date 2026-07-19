import { SlashCommandBuilder } from 'discord.js';
import db, { getStrongholdAtHex } from '../lib/db.js';
import { requirePlayerArmy } from '../lib/command-helpers.js';
import { fetchArmyStats } from '../lib/sheets.js';
import type { Command } from '../types.js';

const siege: Command = {
  data: new SlashCommandBuilder()
    .setName('siege')
    .setDescription('Lay siege to the stronghold in your current hex.'),

  async execute(interaction) {
    const player = await requirePlayerArmy(interaction);
    if (!player) return;
    const { army, commander, sheetId } = player;

    await interaction.deferReply();

    const stats = await fetchArmyStats(sheetId);
    const stronghold = getStrongholdAtHex(stats.hex_q, stats.hex_r);
    if (!stronghold) {
      await interaction.editReply(
        `There is no stronghold at (${stats.hex_q},${stats.hex_r}) — nothing to besiege.`,
      );
      return;
    }

    const faction = commander.faction_id
      ? (db.prepare('SELECT name FROM factions WHERE id = ?').get(commander.faction_id) as
          | { name: string }
          | undefined)
      : undefined;
    if (faction && stronghold.controlled_by && faction.name === stronghold.controlled_by) {
      await interaction.editReply(
        `**${stronghold.name}** is held by your own faction. You cannot besiege it.`,
      );
      return;
    }

    // One live order at a time: cancel any existing move, forage, sell, or siege order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type IN ('forage', 'move', 'sell', 'siege') AND processed_at IS NULL",
    ).run(army.id);

    // The target hex is frozen at order time so the tick can verify the army
    // actually stays at the siege.
    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'siege', ?)").run(
      army.id,
      JSON.stringify({ hex_q: stats.hex_q, hex_r: stats.hex_r }),
    );

    await interaction.editReply(
      `⚔️ Siege order queued — from the next night update your army invests **${stronghold.name}**. ` +
        `The first threshold roll comes after 7 days of siege. Your army must stay in the hex; ` +
        `marching away abandons the siege.`,
    );
  },
};

export default siege;
