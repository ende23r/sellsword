import type { Client, TextChannel } from 'discord.js';

export async function notifyAdmin(client: Client, message: string): Promise<void> {
  const channelId = process.env.ADMIN_CHANNEL_ID;
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch?.isTextBased()) await (ch as TextChannel).send(message);
  } catch {
    // Non-fatal — admin channel notification failure should never block the player
  }
}
