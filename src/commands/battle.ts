import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { TextChannel } from 'discord.js';
import db from '../lib/db.js';
import { notifyAdmin } from '../lib/admin-notify.js';
import { resolveBattle, type BattleOutcome } from '../lib/battle.js';
import type { Command } from '../types.js';

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function formatSide(side: BattleOutcome['sideA']): string {
  return `**${side.name}** roll ${side.roll} ${sign(side.modifier)} = **${side.total}**`;
}

function formatAdminMessage(outcome: BattleOutcome): string {
  const { sideA, sideB, winner, diff, impossible, hexQ, hexR } = outcome;

  const victor = winner === 'a' ? sideA : winner === 'b' ? sideB : null;
  const loser = winner === 'a' ? sideB : winner === 'b' ? sideA : null;

  const lines: string[] = [
    `⚔️ **BATTLE** at (${hexQ},${hexR < 0 ? '−' + Math.abs(hexR) : hexR}) — **${sideA.name}** vs **${sideB.name}**`,
    `${formatSide(sideA)}  |  ${formatSide(sideB)}  |  Diff: ${diff}`,
  ];

  if (winner === 'draw') {
    lines.push(`🤝 **Draw** — both sides take ${outcome.victorCasualtyPct}% casualties`);
  } else if (victor && loser) {
    const victorLine = `🏆 **${victor.name}** — ${outcome.victorCasualtyPct}% casualties${outcome.victorMoraleDelta !== 0 ? `, morale ${sign(outcome.victorMoraleDelta)}` : ''}`;
    const captureStr = outcome.captureRoll !== null
      ? ` | Capture roll: ${outcome.captureRoll} — ${outcome.loserCaptured ? '**captured!**' : 'not captured'}`
      : '';
    const loserLineStr = `💀 **${loser.name}** — ${outcome.loserCasualtyPct}% casualties${outcome.loserMoraleDelta !== 0 ? `, morale ${sign(outcome.loserMoraleDelta)}` : ''}${captureStr}`;
    lines.push(victorLine, loserLineStr);
    if (impossible) lines.push(`⚡ Impossible battle — extra casualties applied, no morale gain for victor.`);
    lines.push(`⚠️ **${loser.name}** must retreat 1 hex. Use \`/teleport\` to move them.`);
    if (outcome.attackerPenalty) {
      const attacker = winner === 'a' ? sideB : sideA;
      lines.push(`📉 **${attacker.name}** (attacker) loses 1 additional morale.`);
    }
  }

  return lines.join('\n');
}

const battle: Command = {
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('(Admin) Resolve a battle between two armies in the same hex.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o.setName('army_a').setDescription('First army ID').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('army_b').setDescription('Second army ID').setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('attacker_id')
        .setDescription('Army ID of the attacker (the other becomes the defender, +1)')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const armyAId = interaction.options.getInteger('army_a', true);
    const armyBId = interaction.options.getInteger('army_b', true);
    const attackerId = interaction.options.getInteger('attacker_id') ?? null;

    const outcome = resolveBattle(db, armyAId, armyBId, attackerId);

    if ('error' in outcome) {
      await interaction.editReply(`❌ ${outcome.error}`);
      return;
    }

    const adminMsg = formatAdminMessage(outcome);
    await notifyAdmin(interaction.client, adminMsg);

    // Notify each army's Discord channel
    for (const side of [outcome.sideA, outcome.sideB]) {
      const row = db
        .prepare(
          'SELECT c.discord_channel_id FROM commanders c JOIN armies a ON a.commander_id = c.id WHERE a.id = ?',
        )
        .get(side.armyId) as { discord_channel_id: string | null } | undefined;

      const channelId = row?.discord_channel_id;
      if (!channelId) continue;

      try {
        const ch = await interaction.client.channels.fetch(channelId);
        if (!ch?.isTextBased()) continue;

        const isVictor = outcome.winner === 'a' ? side === outcome.sideA : outcome.winner === 'b' ? side === outcome.sideB : false;
        const isDraw = outcome.winner === 'draw';
        const enemy = side === outcome.sideA ? outcome.sideB : outcome.sideA;
        const hexCoord = `(${outcome.hexQ},${outcome.hexR < 0 ? '−' + Math.abs(outcome.hexR) : outcome.hexR})`;

        let msg: string;
        if (isDraw) {
          msg = `⚔️ Battle at ${hexCoord}: drawn with **${enemy.name}** — ${outcome.victorCasualtyPct}% casualties. No retreat required.`;
        } else if (isVictor) {
          msg = `⚔️ Battle at ${hexCoord}: you defeated **${enemy.name}** — ${outcome.victorCasualtyPct}% casualties${outcome.victorMoraleDelta !== 0 ? `, morale ${sign(outcome.victorMoraleDelta)}` : ''}.`;
        } else {
          msg = `⚔️ Battle at ${hexCoord}: you were defeated by **${enemy.name}** — ${outcome.loserCasualtyPct}% casualties${outcome.loserMoraleDelta !== 0 ? `, morale ${sign(outcome.loserMoraleDelta)}` : ''}. Await GM retreat orders.`;
        }

        await (ch as TextChannel).send(msg);
      } catch {
        // Channel unavailable — continue
      }
    }

    await interaction.editReply('✅ Battle resolved. See the admin channel for the full breakdown.');
  },
};

export default battle;
