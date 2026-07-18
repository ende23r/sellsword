import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { TextChannel } from 'discord.js';
import {
  getArmiesAtHex,
  getArmyByDiscordId,
  getCommanderByArmyId,
  getConferenceChannelForHex,
  getStrongholdAtHex,
  saveConferenceChannel,
} from '../lib/db.js';
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

    const { hex_q: q, hex_r: r } = army;
    const guild = interaction.guild;

    const stronghold = getStrongholdAtHex(q, r);
    const channelName = conferenceChannelName(q, r, stronghold?.name);

    const armiesAtHex = getArmiesAtHex(q, r);
    const userIds = armiesAtHex
      .map((a) => getCommanderByArmyId(a.id)?.discord_user_id)
      .filter((id): id is string => !!id);

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
          ...userIds.map((userId) => ({
            id: userId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          })),
        ],
      })) as TextChannel;
      saveConferenceChannel(q, r, channel.id);
    } else {
      for (const userId of userIds) {
        await channel.permissionOverwrites.create(userId, {
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
