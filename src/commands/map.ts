import { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getAllHexes, getAllStrongholds, getArmyByDiscordId } from '../lib/db.js';
import db from '../lib/db.js';
import { getArmiesForMap, getPlayerMapHexes, renderMap } from '../lib/map-render.js';
import type { Command } from '../types.js';

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
    const armies = getArmiesForMap(db);

    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const fullMap = isAdmin && (interaction.options.getBoolean('full') ?? false);

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

      // Scouting range: 1 hex normally, 2 hexes with cavalry; fog border adds 1 more ring
      const scoutRange = army.cavalry > 0 ? 2 : 1;
      ({ hexes: renderHexes, visibleCoords } = getPlayerMapHexes(
        hexes,
        { q: army.hex_q, r: army.hex_r },
        scoutRange,
      ));
    }

    const png = await renderMap(renderHexes, strongholds, {
      visibleCoords,
      armyPositions: armies,
    });

    const attachment = new AttachmentBuilder(png, { name: 'map.png' });
    const label = fullMap ? 'Full map' : `Your visible area (scouting range)`;
    await interaction.editReply({ content: `**${label}**`, files: [attachment] });
  },
};

export default map;
