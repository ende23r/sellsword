import { existsSync, readFileSync } from 'fs';
import { google } from 'googleapis';
import type { Client } from 'discord.js';
import { checkDemandsTab, checkMessagesTab, checkQueueTab, checkStatsNamedRanges } from './sheet-checks.js';

type CheckResult = { label: string; ok: boolean; detail?: string };

function warn(results: CheckResult[]): void {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log('✅ Startup checks passed.');
    return;
  }
  console.warn(`\n⚠️  ${failed.length} startup check(s) failed:\n`);
  for (const r of failed) {
    console.warn(`  ✗ ${r.label}${r.detail ? `: ${r.detail}` : ''}`);
  }
  console.warn('');
}

// ── Env / config checks (synchronous) ────────────────────────────────────

function checkEnvVars(): CheckResult[] {
  const required: [string, string][] = [
    ['DISCORD_TOKEN', 'needed to log in to Discord'],
    ['DISCORD_APP_ID', 'needed for slash command registration'],
    ['DISCORD_GUILD_ID', 'needed for slash command registration'],
    ['ADMIN_CHANNEL_ID', 'needed for admin notifications and daily updates'],
    ['SCHEDULE_TIMEZONE', 'needed for daily update scheduling'],
    ['GOOGLE_SERVICE_ACCOUNT_KEY', 'needed for Google Sheets integration'],
    ['ADMIN_SHEET_ID', 'needed to log queue entries and messages'],
    ['ARMY_SHEET_TEMPLATE_ID', 'needed by /commission to copy army sheets'],
  ];
  return required.map(([key, detail]) => ({
    label: `env: ${key}`,
    ok: !!process.env[key],
    detail: process.env[key] ? undefined : detail,
  }));
}

function checkTimezone(): CheckResult {
  const tz = process.env.SCHEDULE_TIMEZONE;
  if (!tz) return { label: 'SCHEDULE_TIMEZONE is a valid IANA timezone', ok: false };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return { label: `SCHEDULE_TIMEZONE "${tz}" is a valid IANA timezone`, ok: true };
  } catch {
    return {
      label: `SCHEDULE_TIMEZONE "${tz}" is a valid IANA timezone`,
      ok: false,
      detail:
        'unrecognized timezone — check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones',
    };
  }
}

function checkServiceAccountKey(): {
  ok: boolean;
  auth?: InstanceType<typeof google.auth.GoogleAuth>;
} {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) return { ok: false };
  if (!existsSync(keyPath)) return { ok: false };
  try {
    const key = JSON.parse(readFileSync(keyPath, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
    return { ok: true, auth };
  } catch {
    return { ok: false };
  }
}

// ── Async checks (API calls) ──────────────────────────────────────────────

async function checkAdminSheet(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
): Promise<CheckResult[]> {
  const sheetId = process.env.ADMIN_SHEET_ID;
  if (!sheetId)
    return [{ label: 'Admin sheet is accessible', ok: false, detail: 'ADMIN_SHEET_ID not set' }];
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'spreadsheetId,properties.title',
    });
    const accessible: CheckResult = {
      label: `Admin sheet "${res.data.properties?.title}" is accessible`,
      ok: true,
    };
    const [queueChecks, messagesChecks, demandsChecks] = await Promise.all([
      checkQueueTab(sheets, sheetId),
      checkMessagesTab(sheets, sheetId),
      checkDemandsTab(sheets, sheetId),
    ]);
    return [accessible, ...queueChecks, ...messagesChecks, ...demandsChecks];
  } catch (err) {
    return [{ label: 'Admin sheet is accessible', ok: false, detail: (err as Error).message }];
  }
}

async function checkArmySheetTemplate(
  auth: InstanceType<typeof google.auth.GoogleAuth>,
): Promise<CheckResult[]> {
  const templateId = process.env.ARMY_SHEET_TEMPLATE_ID;
  if (!templateId)
    return [
      {
        label: 'Army sheet template is accessible',
        ok: false,
        detail: 'ARMY_SHEET_TEMPLATE_ID not set',
      },
    ];
  try {
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.get({ fileId: templateId, fields: 'id,name' });
    const accessible: CheckResult = {
      label: `Army sheet template "${res.data.name}" is accessible`,
      ok: true,
    };
    const sheets = google.sheets({ version: 'v4', auth });
    const statsChecks = await checkStatsNamedRanges(sheets, templateId);
    return [accessible, ...statsChecks];
  } catch (err) {
    return [
      {
        label: 'Army sheet template is accessible',
        ok: false,
        detail: (err as Error).message,
      },
    ];
  }
}

// ── Discord checks (run after ClientReady) ────────────────────────────────

export function checkQueueRole(guild: { roles: { cache: { find(fn: (r: { name: string }) => boolean): unknown } } }): CheckResult {
  const found = guild.roles.cache.find((r) => r.name === 'Queued');
  return {
    label: 'Discord guild has a "Queued" role',
    ok: !!found,
    detail: found ? undefined : 'Create a role named "Queued" so /queue and /unqueue can assign it',
  };
}

export async function checkAdminChannel(client: Client): Promise<void> {
  const results: CheckResult[] = [];

  const channelId = process.env.ADMIN_CHANNEL_ID;
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      results.push({
        label: 'Admin channel is accessible and is a text channel',
        ok: !!channel?.isTextBased(),
        detail: channel?.isTextBased() ? undefined : 'channel exists but is not a text channel',
      });
    } catch {
      results.push({
        label: 'Admin channel is accessible and is a text channel',
        ok: false,
        detail: `could not fetch channel ${channelId} — does the bot have access?`,
      });
    }
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      results.push(checkQueueRole(guild));
    }
  }

  warn(results);
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function runStartupChecks(): Promise<void> {
  console.log('Running startup checks…');

  const results: CheckResult[] = [...checkEnvVars(), checkTimezone()];

  const { ok: keyOk, auth } = checkServiceAccountKey();
  results.push({
    label: 'Service account key file is readable and valid JSON',
    ok: keyOk,
    detail: keyOk ? undefined : 'check GOOGLE_SERVICE_ACCOUNT_KEY path',
  });

  if (auth) {
    const [adminSheetResults, templateResults] = await Promise.all([
      checkAdminSheet(auth),
      checkArmySheetTemplate(auth),
    ]);
    results.push(...adminSheetResults, ...templateResults);
  } else {
    results.push(
      {
        label: 'Admin sheet is accessible',
        ok: false,
        detail: 'skipped (no valid service account key)',
      },
      {
        label: 'Army sheet template is accessible',
        ok: false,
        detail: 'skipped (no valid service account key)',
      },
    );
  }

  warn(results);
}
