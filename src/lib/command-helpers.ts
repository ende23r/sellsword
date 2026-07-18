import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { getArmyByDiscordId, getCommanderByDiscordId } from './db.js';
import type { ArmyRow, CommanderRow } from './db.js';
import { extractSheetId } from './sheets.js';

export type PlayerArmy = {
  army: ArmyRow;
  commander: CommanderRow;
  sheetId: string;
};

// Shared preamble for player commands that act on the invoker's army sheet.
// Replies ephemerally and returns null when the user has no army or no sheet configured.
export async function requirePlayerArmy(
  interaction: ChatInputCommandInteraction,
): Promise<PlayerArmy | null> {
  const army = getArmyByDiscordId(interaction.user.id);
  if (!army) {
    await interaction.reply({ content: 'You have no army.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const commander = getCommanderByDiscordId(interaction.user.id);
  const sheetId = extractSheetId(commander?.army_sheet_url);
  if (!commander || !sheetId) {
    await interaction.reply({
      content: 'Your army has no sheet configured.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return { army, commander, sheetId };
}
