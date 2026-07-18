import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { upsertFaction } from '../lib/faction-ops.js';
import { shareSheetPublic, syncArmySheet, type ArmySheetStats } from '../lib/sheets.js';
import type { Command } from '../types.js';

// TODO: automate sheet creation once a Drive solution that works with
// personal Gmail service accounts is found (quota is 0, ownership transfer
// requires Workspace, Shared Drives require Workspace Business).
// For now the admin copies the template manually and pastes the ID here.

const commission: Command = {
  data: new SlashCommandBuilder()
    .setName('commission')
    .setDescription('(Admin) Create an army channel for a new commander.')
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
    )
    .addStringOption((o) =>
      o
        .setName('sheet_id')
        .setDescription('Army sheet ID or URL (copy the template manually first)')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild!;
    const commanderUser = interaction.options.getUser('commander', true);
    const factionRole = interaction.options.getRole('faction', true);
    const armyName = interaction.options.getString('army_name', true);
    const startQ = interaction.options.getInteger('start_q', true);
    const startR = interaction.options.getInteger('start_r', true);
    const sheetInput = interaction.options.getString('sheet_id');

    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === factionRole.name,
    );
    if (!category) {
      await interaction.editReply(
        `No Discord category named **"${factionRole.name}"** found. Create one first.`,
      );
      return;
    }

    const existingArmy = db
      .prepare(
        `SELECT a.id FROM armies a
         JOIN commanders c ON c.id = a.commander_id
         WHERE c.discord_user_id = ?`,
      )
      .get(commanderUser.id);
    if (existingArmy) {
      await interaction.editReply(
        `**${commanderUser.username}** already has an army. Use \`/drop-army\` first if you want to recommission them.`,
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
    if (sheetInput) {
      const match = sheetInput.match(/\/d\/([^/]+)/);
      const sheetId = match ? match[1] : sheetInput;
      sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
      await shareSheetPublic(sheetId);
      const defaultStats: ArmySheetStats = {
        infantry: 0, cavalry: 0, wagons: 0, noncombatants: 0,
        morale: 9, resting_morale: 9, max_morale: 12,
        supplies: 0, coin: 0, goods: 0,
        stance: 'allow',
        infantry_strength: 0, cavalry_strength: 0, scouting_range: 1,
        forced_march: false, night_march: false,
      };
      await syncArmySheet(sheetId, defaultStats, startQ, startR);
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
      `⚔️ **${commanderUser.username}** commissioned as commander of **${armyName}** in faction **${factionRole.name}**. Channel: ${channel}${sheetUrl ? ` | Sheet: ${sheetUrl}` : ''}`,
    );

    await interaction.editReply(
      `✅ **${commanderUser.username}** commissioned!\nChannel: ${channel}${sheetUrl ? `\nArmy sheet: ${sheetUrl}` : ''}`,
    );
  },
};

export default commission;
