import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { upsertFaction } from '../lib/faction-ops.js';
import { copyArmySheetTemplate } from '../lib/sheets.js';
import type { Command } from '../types.js';

const commission: Command = {
  data: new SlashCommandBuilder()
    .setName('commission')
    .setDescription('(Admin) Create an army channel and army sheet for a new commander.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addUserOption((o) =>
      o.setName('commander').setDescription('The player to commission').setRequired(true),
    )
    .addRoleOption((o) =>
      o.setName('faction').setDescription('Their faction role').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('army_name').setDescription("Name for the commander's army").setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('start_q').setDescription('Starting hex Q coordinate').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('start_r').setDescription('Starting hex R coordinate').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild!;
    const commanderUser = interaction.options.getUser('commander', true);
    const factionRole = interaction.options.getRole('faction', true);
    const armyName = interaction.options.getString('army_name', true);
    const startQ = interaction.options.getInteger('start_q', true);
    const startR = interaction.options.getInteger('start_r', true);

    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === factionRole.name,
    );
    if (!category) {
      await interaction.editReply(
        `No Discord category named **"${factionRole.name}"** found. Create one first.`,
      );
      return;
    }

    const channelName = armyName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const channel = await guild.channels.create({
      name: `army-${channelName}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: commanderUser.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        { id: factionRole.id, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });

    let sheetUrl: string | null = null;
    try {
      const sheet = await copyArmySheetTemplate(`${armyName} (${commanderUser.username})`);
      sheetUrl = sheet.url;
    } catch (err) {
      console.error('Failed to copy army sheet template:', err);
    }

    const factionId = upsertFaction(db, factionRole.name, factionRole.id, category.id);

    const commanderStmt = db.prepare(`
      INSERT INTO commanders (discord_user_id, discord_channel_id, faction_id, army_sheet_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET
        discord_channel_id = excluded.discord_channel_id,
        faction_id = excluded.faction_id,
        army_sheet_url = excluded.army_sheet_url
    `);
    commanderStmt.run(commanderUser.id, channel.id, factionId, sheetUrl);

    const commander = db
      .prepare('SELECT * FROM commanders WHERE discord_user_id = ?')
      .get(commanderUser.id) as { id: number };

    db.prepare(
      `INSERT INTO armies (commander_id, name, hex_q, hex_r)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(commander_id) DO NOTHING`,
    ).run(commander.id, armyName, startQ, startR);

    if (sheetUrl) {
      await channel.send(`📋 **Army Sheet:** ${sheetUrl}`);
    }

    await notifyAdmin(
      interaction.client,
      `⚔️ **${commanderUser.username}** commissioned as commander of **${armyName}** in faction **${factionRole.name}**. Channel: ${channel}${sheetUrl ? ` | Sheet: ${sheetUrl}` : ' | ⚠️ Sheet creation failed.'}`,
    );

    await interaction.editReply(
      `✅ **${commanderUser.username}** commissioned!\nChannel: ${channel}\n${sheetUrl ? `Army sheet: ${sheetUrl}` : '⚠️ Army sheet creation failed — add manually.'}`,
    );
  },
};

export default commission;
