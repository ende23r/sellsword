import { SlashCommandBuilder } from 'discord.js';
import db, { getArmyByDiscordId, getHex } from '../lib/db.js';
import { hexDistance } from '../lib/hex.js';
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
      await interaction.reply({ content: 'You have no army.', ephemeral: true });
      return;
    }

    const destQ = interaction.options.getInteger('q', true);
    const destR = interaction.options.getInteger('r', true);
    const roadsOnly = interaction.options.getBoolean('roads_only') ?? false;

    const destHex = getHex(destQ, destR);
    if (!destHex) {
      await interaction.reply({
        content: `Hex (${destQ},${destR}) does not exist on the map.`,
        ephemeral: true,
      });
      return;
    }

    const dist = hexDistance({ q: army.hex_q, r: army.hex_r }, { q: destQ, r: destR });
    if (dist !== 1) {
      await interaction.reply({
        content: `You can only move to an adjacent hex (distance 1). Hex (${destQ},${destR}) is distance ${dist} away.`,
        ephemeral: true,
      });
      return;
    }

    if (!roadsOnly && army.wagons > 0) {
      await interaction.reply({
        content:
          '⚠️ Armies with wagons cannot travel off-road. Use `roads_only: true` or detach your wagons first.',
        ephemeral: true,
      });
      return;
    }

    // Cancel any existing move order
    db.prepare(
      "DELETE FROM orders WHERE army_id = ? AND type = 'move' AND processed_at IS NULL",
    ).run(army.id);

    db.prepare("INSERT INTO orders (army_id, type, parameters) VALUES (?, 'move', ?)").run(
      army.id,
      JSON.stringify({ dest_q: destQ, dest_r: destR, roads_only: roadsOnly }),
    );

    await interaction.reply(
      `✅ Move order queued: **(${army.hex_q},${army.hex_r}) → (${destQ},${destR})** — will be processed at the next update.\nTerrain: **${destHex.terrain}**${roadsOnly ? ' · roads only' : ''}`,
    );
  },
};

export default move;
