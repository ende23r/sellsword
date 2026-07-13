import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** If true, the command responds normally even when the bot is in pause mode. */
  allowInPause?: boolean;
}

// Convenience re-export of DB row types used across commands
export type {
  ArmyRow,
  CommanderRow,
  FactionRow,
  HexRow,
  OrderRow,
  StrongholdRow,
} from './lib/db.js';

export type QueueEntry = {
  id: number;
  discord_user_id: string;
  discord_username: string;
  added_at: string;
  added_by_id: string;
};
