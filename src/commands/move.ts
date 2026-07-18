import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getCommanderByDiscordId, getHex } from '../lib/db.js';
import { extractSheetId, fetchArmyStats } from '../lib/sheets.js';
import type { Command } from '../types.js';

const move: Command = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Queue a movement order for the next update.')
    .addIntegerOption((o) =>
      o.setName('q').setDescription('Destination hex Q coordinate').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('r').setDescription('Destination hex R coordinate').setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName('roads_only')
        .setDescription('Stay on roads only (wagons must use this)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const army = getArmyByDiscordId(interaction.user.id);
    if (!army) {
      await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
      return;
    }

    const destQ = interaction.options.getInteger('q', true);
    const destR = interaction.options.getInteger('r', true);
    const roadsOnly = interaction.options.getBoolean('roads_only') ?? false;

    const destHex = getHex(destQ, destR);
    if (!destHex) {
      await interaction.reply({
        content: `Hex (${destQ},${destR}) does not exist on the map.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (destHex.speed === 0) {
      await interaction.reply({
        content: `Hex (${destQ},${destR}) is impassable terrain (${destHex.terrain}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const commander = getCommanderByDiscordId(interaction.user.id);
    const sheetId = extractSheetId(commander?.army_sheet_url);
    if (!sheetId) {
      await interaction.reply({
        content: 'Your army has no sheet configured.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const armyStats = await fetchArmyStats(sheetId);

    if (destQ === armyStats.hex_q && destR === armyStats.hex_r) {
      db.prepare(
        "DELETE FROM orders WHERE army_id = ? AND type IN ('move', 'forage') AND processed_at IS NULL",
      ).run(army.id);
      await interaction.editReply(
        `🛑 That's your current position. Movement orders cancelled — army will hold at **(${armyStats.hex_q},${armyStats.hex_r})**.`,
      );
      return;
    }

    if (!roadsOnly && armyStats.wagons > 0) {
      await interaction.editReply(
        '⚠️ Armies with wagons cannot travel off-road. Use `roads_only: true` or detach your wagons first.',
      );
      return;
    }

    // One live order at a time: cancel any existing move or forage order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type IN ('move', 'forage') AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'move', ?)").run(
      army.id,
      JSON.stringify({ dest_q: destQ, dest_r: destR, roads_only: roadsOnly }),
    );

    const dist = Math.round(
      (Math.abs(armyStats.hex_q - destQ) +
        Math.abs(armyStats.hex_q + armyStats.hex_r - destQ - destR) +
        Math.abs(armyStats.hex_r - destR)) /
        2,
    );
    await interaction.editReply(
      `✅ Move order queued: **(${armyStats.hex_q},${armyStats.hex_r}) → (${destQ},${destR})** (${dist} hex${dist !== 1 ? 'es' : ''} away) — army will advance each night tick until it arrives.\nTerrain: **${destHex.terrain}**${roadsOnly ? ' · roads only' : ''}`,
    );
  },
};

export default move;
