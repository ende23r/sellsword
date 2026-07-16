import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import db from '../lib/db.js';
import type { Command } from '../types.js';

const listArmies: Command = {
  data: new SlashCommandBuilder()
    .setName('list-armies')
    .setDescription('(Admin) List all armies currently in play.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const rows = db.prepare(
      `SELECT a.id, a.name, a.hex_q, a.hex_r, c.discord_user_id
       FROM armies a
       JOIN commanders c ON c.id = a.commander_id
       ORDER BY a.id`,
    ).all() as { id: number; name: string; hex_q: number; hex_r: number; discord_user_id: string }[];

    if (rows.length === 0) {
      await interaction.reply({ content: 'No armies in play.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = rows.map(
      (r) => `\`ID ${r.id}\` **${r.name}** — <@${r.discord_user_id}> | Hex (${r.hex_q}, ${r.hex_r})`,
    );
    await interaction.reply({
      content: `**Armies in play (${rows.length})**\n${lines.join('\n')}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default listArmies;
