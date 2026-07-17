import type { Client, TextChannel } from 'discord.js';
import cron from 'node-cron';
import { runDailyUpdate, runMessageDelivery, type UpdatePhase } from './daily-update.js';

export function startScheduler(client: Client): void {
  const tz = process.env.SCHEDULE_TIMEZONE;
  if (!tz) {
    console.warn('SCHEDULE_TIMEZONE not set — daily updates will not be scheduled.');
    return;
  }

  const adminChannelId = process.env.ADMIN_CHANNEL_ID;
  if (!adminChannelId) {
    console.warn('ADMIN_CHANNEL_ID not set — daily updates will not be scheduled.');
    return;
  }

  const fetchAdminChannel = async (): Promise<TextChannel | null> => {
    const channel = await client.channels.fetch(adminChannelId);
    if (!channel?.isTextBased()) {
      console.error('Admin channel is not a text channel.');
      return null;
    }
    return channel as TextChannel;
  };

  // Daily update ticks — registered first so they run before the message tick at shared hours.
  const scheduleUpdate = (phase: UpdatePhase, cronExpr: string) => {
    cron.schedule(
      cronExpr,
      async () => {
        if (process.env.PAUSED === 'true') return;
        try {
          const channel = await fetchAdminChannel();
          if (channel) await runDailyUpdate(phase, channel);
        } catch (err) {
          console.error(`Daily update (${phase}) failed:`, err);
        }
      },
      { timezone: tz },
    );
  };

  scheduleUpdate('morning', '0 6 * * *');
  scheduleUpdate('noon', '0 14 * * *');
  scheduleUpdate('night', '0 22 * * *');

  // Hourly message delivery — registered after daily ticks to ensure ordering at shared hours.
  cron.schedule(
    '0 * * * *',
    async () => {
      if (process.env.PAUSED === 'true') return;
      try {
        const channel = await fetchAdminChannel();
        if (channel) await runMessageDelivery(channel);
      } catch (err) {
        console.error('Message delivery tick failed:', err);
      }
    },
    { timezone: tz },
  );

  console.log(`Scheduler started (timezone: ${tz}) — updates at 06:00, 14:00, 22:00; messages every hour.`);
}
