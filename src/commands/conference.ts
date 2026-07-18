import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { GuildMember, TextChannel } from 'discord.js';
import db, {
  getArmyByDiscordId,
  getCommanderByArmyId,
  getConferenceChannelForHex,
  getStrongholdAtHex,
  saveConferenceChannel,
} from '../lib/db.js';
import { extractSheetId, fetchArmyStats } from '../lib/sheets.js';
import { conferenceChannelName } from '../lib/conference-ops.js';
import type { Command } from '../types.js';

const conference: Command = {
  data: new SlashCommandBuilder()
    .setName('conference')
    .setDescription('Open a private channel with all commanders in your hex.'),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const army = getArmyByDiscordId(interaction.user.id);
    if (!army) {
      await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Fetch all army stats to determine hex positions
    const allArmiesRows = db
      .prepare('SELECT a.id, c.army_sheet_url FROM armies a JOIN commanders c ON c.id = a.commander_id')
      .all() as { id: number; army_sheet_url: string | null }[];

    const statsMap = new Map<number, { hex_q: number; hex_r: number }>();
    await Promise.all(
      allArmiesRows.map(async (row) => {
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

    const myStats = statsMap.get(army.id);
    if (!myStats) {
      await interaction.editReply('Your army position is not available (no sheet configured).');
      return;
    }

    const q = myStats.hex_q;
    const r = myStats.hex_r;
    const guild = interaction.guild;

    const stronghold = getStrongholdAtHex(q, r);
    const channelName = conferenceChannelName(q, r, stronghold?.name);

    // Find all armies at this hex
    const armiesAtHex: { id: number; name: string | null }[] = [];
    for (const [id, s] of statsMap) {
      if (s.hex_q === q && s.hex_r === r) {
        const nameRow = db.prepare('SELECT name FROM armies WHERE id = ?').get(id) as { name: string | null } | undefined;
        armiesAtHex.push({ id, name: nameRow?.name ?? null });
      }
    }

    const userIds = armiesAtHex
      .map((a) => getCommanderByArmyId(a.id)?.discord_user_id)
      .filter((id): id is string => !!id);

    // Fetch GuildMembers — permissionOverwrites.create() requires resolved members, not raw IDs
    const members = (
      await Promise.all(userIds.map((id) => guild.members.fetch(id).catch(() => null)))
    ).filter((m): m is GuildMember => m !== null);

    // Find or create the Conferences category
    let category = guild.channels.cache.find(
      (ch) => ch.name === 'Conferences' && ch.type === ChannelType.GuildCategory,
    );
    if (!category) {
      category = await guild.channels.create({ name: 'Conferences', type: ChannelType.GuildCategory });
    }

    // Find or create conference channel for this hex
    let channel: TextChannel | null = null;
    const existing = getConferenceChannelForHex(q, r);

    if (existing) {
      try {
        channel = (await guild.channels.fetch(existing.discord_channel_id)) as TextChannel;
      } catch {
        channel = null;
      }
    }

    if (!channel) {
      channel = (await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          ...members.map((member) => ({
            id: member,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          })),
        ],
      })) as TextChannel;
      saveConferenceChannel(q, r, channel.id);
    } else {
      for (const member of members) {
        await channel.permissionOverwrites.create(member, {
          ViewChannel: true,
          SendMessages: true,
        });
      }
    }

    const hexCoord = `(${q},${r < 0 ? '−' + Math.abs(r) : r})`;
    const names = armiesAtHex.map((a) => a.name ?? `Army ${a.id}`).join(', ');
    await channel.send(`📋 **Conference convened** at ${hexCoord} — Present: ${names}`);

    await interaction.editReply(`Conference channel opened: <#${channel.id}>`);
  },
};

export default conference;
