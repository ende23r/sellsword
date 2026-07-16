import { SlashCommandBuilder } from 'discord.js';
import type { TextChannel } from 'discord.js';
import db from '../lib/db.js';
import type { Command } from '../types.js';

const gmping: Command = {
  data: new SlashCommandBuilder()
    .setName('gmping')
    .setDescription('Ask the GM a question or issue a special order.')
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('Your question or order')
        .setRequired(true)
        .setMaxLength(1000),
    ),
  allowInPause: true,

  async execute(interaction) {
    const content = interaction.options.getString('message', true);

    const row = db
      .prepare(
        `SELECT a.name AS army_name, a.hex_q, a.hex_r, f.name AS faction_name
         FROM commanders c
         LEFT JOIN armies a ON a.commander_id = c.id
         LEFT JOIN factions f ON f.id = c.faction_id
         WHERE c.discord_user_id = ?`,
      )
      .get(interaction.user.id) as {
      army_name: string | null;
      hex_q: number | null;
      hex_r: number | null;
      faction_name: string | null;
    } | null;

    let contextLine: string;
    if (!row) {
      contextLine = '_(not in game)_';
    } else {
      const parts: string[] = [];
      if (row.faction_name) parts.push(`**Faction:** ${row.faction_name}`);
      if (row.army_name) {
        parts.push(`**Army:** ${row.army_name} @ (${row.hex_q},${row.hex_r})`);
      } else {
        parts.push('_(no army)_');
      }
      contextLine = parts.join(' | ');
    }

    const channelId = process.env.GM_PING_CHANNEL_ID;
    if (channelId) {
      try {
        const ch = await interaction.client.channels.fetch(channelId);
        if (ch?.isTextBased()) {
          const quoted = content.replace(/\n/g, '\n> ');
          await (ch as TextChannel).send(
            `📨 **GM Ping** from **${interaction.user.username}** (<@${interaction.user.id}>)\n${contextLine}\n> ${quoted}`,
          );
        }
      } catch {
        // Non-fatal — never block the player
      }
    }

    await interaction.reply({
      content: `📨 **GM Ping** from ${interaction.user}\n> ${content.replace(/\n/g, '\n> ')}\n_Sent to the GMs — they'll respond when they can._`,
    });
  },
};

export default gmping;
