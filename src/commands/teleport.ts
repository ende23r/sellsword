import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { extractSheetId, fetchArmyStats, syncArmySheet } from '../lib/sheets.js';
import type { Command } from '../types.js';

const teleport: Command = {
  allowInPause: true,

  data: new SlashCommandBuilder()
    .setName('teleport')
    .setDescription('(Admin) Immediately move an army to any hex.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((o) =>
      o.setName('army_id').setDescription('Army ID (from /list-armies)').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('q').setDescription('Destination hex Q coordinate').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('r').setDescription('Destination hex R coordinate').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const armyId = interaction.options.getInteger('army_id', true);
    const q = interaction.options.getInteger('q', true);
    const r = interaction.options.getInteger('r', true);

    const army = db
      .prepare(
        `SELECT a.id, a.name, c.army_sheet_url
         FROM armies a JOIN commanders c ON c.id = a.commander_id
         WHERE a.id = ?`,
      )
      .get(armyId) as { id: number; name: string | null; army_sheet_url: string | null } | undefined;

    if (!army) {
      await interaction.editReply(`No army with ID ${armyId}.`);
      return;
    }

    const hex = db
      .prepare('SELECT * FROM hexes WHERE q = ? AND r = ?')
      .get(q, r) as { q: number; r: number } | undefined;

    if (!hex) {
      await interaction.editReply(`No hex at (${q},${r}).`);
      return;
    }

    const sheetId = extractSheetId(army.army_sheet_url);
    if (!sheetId) {
      await interaction.editReply(`Army ${armyId} has no sheet configured — cannot update position.`);
      return;
    }

    const stats = await fetchArmyStats(sheetId);
    stats.hex_q = q;
    stats.hex_r = r;
    await syncArmySheet(sheetId, stats);

    await interaction.editReply(
      `✅ **${army.name ?? army.id}** teleported to (${q},${r}).`,
    );
  },
};

export default teleport;
