import { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getAllHexes, getAllStrongholds, getArmyByDiscordId } from '../lib/db.js';
import db from '../lib/db.js';
import { extractSheetId, fetchArmyStats, type ArmySheetStats } from '../lib/sheets.js';
import { getArmiesForMap, getPlayerMapHexes, renderMap } from '../lib/map-render.js';
import type { Command } from '../types.js';

async function fetchAllArmyStatsForMap(): Promise<Map<number, ArmySheetStats>> {
  const rows = db
    .prepare('SELECT a.id, c.army_sheet_url FROM armies a JOIN commanders c ON c.id = a.commander_id')
    .all() as { id: number; army_sheet_url: string | null }[];

  const statsMap = new Map<number, ArmySheetStats>();
  await Promise.all(
    rows.map(async (row) => {
      const sheetId = extractSheetId(row.army_sheet_url);
      if (!sheetId) return;
      try {
        const stats = await fetchArmyStats(sheetId);
        statsMap.set(row.id, stats);
      } catch {
        // Skip armies whose sheets are unavailable
      }
    }),
  );
  return statsMap;
}

const map: Command = {
  allowInPause: true,

  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('Render the map. Players see their scouting range; admins see everything.')
    .addBooleanOption((o) =>
      o.setName('full').setDescription('(Admin) Show the full map').setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const hexes = getAllHexes();
    if (hexes.length === 0) {
      await interaction.editReply('No map data found. Run `npm run seed` to seed the database.');
      return;
    }

    const strongholds = getAllStrongholds();
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const fullMap = isAdmin && (interaction.options.getBoolean('full') ?? false);

    const statsMap = await fetchAllArmyStatsForMap();
    const armyPositions = getArmiesForMap(db, statsMap);

    let renderHexes = hexes;
    let visibleCoords: Set<string> | undefined;

    if (!fullMap) {
      const army = getArmyByDiscordId(interaction.user.id);
      if (!army) {
        await interaction.editReply(
          'You have no army. Only players with an army can view the map.',
        );
        return;
      }

      const armyStats = statsMap.get(army.id);
      if (!armyStats) {
        await interaction.editReply('Your army position is not available (no sheet configured).');
        return;
      }

      const scoutRange = armyStats.scouting_range;
      ({ hexes: renderHexes, visibleCoords } = getPlayerMapHexes(
        hexes,
        { q: armyStats.hex_q, r: armyStats.hex_r },
        scoutRange,
      ));
    }

    const png = await renderMap(renderHexes, strongholds, {
      visibleCoords,
      armyPositions,
      showSettlementScores: fullMap,
    });

    const attachment = new AttachmentBuilder(png, { name: 'map.png' });
    const label = fullMap ? 'Full map' : `Your visible area (scouting range)`;
    await interaction.editReply({ content: `**${label}**`, files: [attachment] });
  },
};

export default map;
