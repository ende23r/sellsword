import type { Client } from 'discord.js';
import cron from 'node-cron';
import { runDailyUpdate, type UpdatePhase } from './daily-update.js';

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

  const schedule = (phase: UpdatePhase, cronExpr: string) => {
    cron.schedule(
      cronExpr,
      async () => {
        if (process.env.PAUSED === 'true') return;
        try {
          const channel = await client.channels.fetch(adminChannelId);
          if (!channel?.isTextBased()) {
            console.error('Admin channel is not a text channel.');
            return;
          }
          await runDailyUpdate(phase, channel as import('discord.js').TextChannel);
        } catch (err) {
          console.error(`Daily update (${phase}) failed:`, err);
        }
      },
      { timezone: tz },
    );
  };

  schedule('morning', '0 6 * * *');
  schedule('noon', '0 14 * * *');
  schedule('night', '0 22 * * *');

  console.log(`Scheduler started (timezone: ${tz}) — updates at 06:00, 14:00, 22:00.`);
}
