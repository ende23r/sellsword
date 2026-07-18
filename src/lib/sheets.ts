// Google Sheets / Drive integration.
//
// TODO(eric): Set up credentials before this module will work:
//   1. Go to https://console.cloud.google.com and create a project.
//   2. Enable the Google Sheets API and the Google Drive API.
//   3. Create a service account (IAM & Admin → Service Accounts → Create).
//   4. Download its JSON key (Actions → Manage Keys → Add Key → JSON).
//   5. Save the file somewhere on disk (e.g. ~/.config/sellsword/service-account.json).
//   6. Set GOOGLE_SERVICE_ACCOUNT_KEY in .env to that file path.
//   7. Share your admin sheet and army sheet template with the service account email
//      (visible in the JSON key as "client_email") — grant Editor access.

import { readFileSync } from 'fs';
import { google } from 'googleapis';
import type { CommanderRow } from './db.js';

// ── Army sheet stats (source of truth; all army data lives here) ──────────────

export type ArmySheetStats = {
  // Logistics counts
  infantry: number;
  cavalry: number;
  wagons: number;
  noncombatants: number;
  // Resources
  morale: number;
  resting_morale: number;
  supplies: number;
  coin: number;
  goods: number;
  // Position (source of truth; written to Hex cell as "q,r")
  hex_q: number;
  hex_r: number;
  // State
  stance: 'allow_passage' | 'engage';
  // Combat strengths (sheet-calculated; bot reads only)
  infantry_strength: number;
  cavalry_strength: number;
  scouting_range: number;
  // Additional stats
  max_morale: number;
  forced_march: boolean;
  night_march: boolean;
};

// TODO(eric): Update these cell references to match your army sheet template.
// The bot reads and writes army stats to/from these named cells on the "Stats" tab.
// Column A holds the row labels; column B holds the values.
export const ARMY_SHEET_CELLS = {
  INFANTRY: 'Stats!B2',
  CAVALRY: 'Stats!B3',
  WAGONS: 'Stats!B4',
  NONCOMBATANTS: 'Stats!B5',
  MORALE: 'Stats!B6',
  RESTING_MORALE: 'Stats!B7',
  SUPPLIES: 'Stats!B8',
  COIN: 'Stats!B9',
  GOODS: 'Stats!B10',
  HEX: 'Stats!B11',        // display only — bot writes, not read back as stats
  STANCE: 'Stats!B12',
  INFANTRY_STRENGTH: 'Stats!B13',   // sheet-calculated; bot reads only
  CAVALRY_STRENGTH: 'Stats!B14',    // sheet-calculated; bot reads only
  SCOUTING_RANGE: 'Stats!B15',      // sheet-calculated; bot reads only
  MAX_MORALE: 'Stats!B16',
  FORCED_MARCH: 'Stats!B17',
  NIGHT_MARCH: 'Stats!B18',
  // Range covering all stat rows (B2:B18, 17 rows)
  ALL_STATS: 'Stats!B2:B18',
};

// Row indices within a B2:B18 read result (0-based)
const ROW = {
  INFANTRY: 0,
  CAVALRY: 1,
  WAGONS: 2,
  NONCOMBATANTS: 3,
  MORALE: 4,
  RESTING_MORALE: 5,
  SUPPLIES: 6,
  COIN: 7,
  GOODS: 8,
  HEX: 9,
  STANCE: 10,
  INFANTRY_STRENGTH: 11,
  CAVALRY_STRENGTH: 12,
  SCOUTING_RANGE: 13,
  MAX_MORALE: 14,
  FORCED_MARCH: 15,
  NIGHT_MARCH: 16,
};

export function parseSheetStats(rows: (string | number | null)[][]): ArmySheetStats {
  const cell = (row: (string | number | null)[] | undefined): string | number | null =>
    row?.[0] ?? null;
  const num = (v: string | number | null, fallback: number): number => {
    const n = Number(v);
    return v !== null && v !== '' && !isNaN(n) ? Math.round(n) : fallback;
  };
  const bool = (v: string | number | null): boolean => {
    if (v === null || v === '') return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  };
  const stance = (v: string | number | null): 'allow_passage' | 'engage' => {
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'engage' || s === 'block' ? 'engage' : 'allow_passage';
  };
  const parseHex = (v: string | number | null): { q: number; r: number } => {
    const parts = String(v ?? '').split(',');
    const q = parseInt(parts[0] ?? '', 10);
    const r = parseInt(parts[1] ?? '', 10);
    return { q: isNaN(q) ? 0 : q, r: isNaN(r) ? 0 : r };
  };

  const hex = parseHex(cell(rows[ROW.HEX]));

  return {
    infantry: num(cell(rows[ROW.INFANTRY]), 0),
    cavalry: num(cell(rows[ROW.CAVALRY]), 0),
    wagons: num(cell(rows[ROW.WAGONS]), 0),
    noncombatants: num(cell(rows[ROW.NONCOMBATANTS]), 0),
    morale: num(cell(rows[ROW.MORALE]), 9),
    resting_morale: num(cell(rows[ROW.RESTING_MORALE]), 9),
    supplies: num(cell(rows[ROW.SUPPLIES]), 0),
    coin: num(cell(rows[ROW.COIN]), 0),
    goods: num(cell(rows[ROW.GOODS]), 0),
    hex_q: hex.q,
    hex_r: hex.r,
    stance: stance(cell(rows[ROW.STANCE])),
    infantry_strength: num(cell(rows[ROW.INFANTRY_STRENGTH]), 0),
    cavalry_strength: num(cell(rows[ROW.CAVALRY_STRENGTH]), 0),
    scouting_range: num(cell(rows[ROW.SCOUTING_RANGE]), 1),
    max_morale: num(cell(rows[ROW.MAX_MORALE]), 12),
    forced_march: bool(cell(rows[ROW.FORCED_MARCH])),
    night_march: bool(cell(rows[ROW.NIGHT_MARCH])),
  };
}

export function extractSheetId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/d\/([^/]+)/);
  return match?.[1] ?? null;
}

let _auth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

function getAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  if (_auth) return _auth;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set in .env');
  const key = JSON.parse(readFileSync(keyPath, 'utf-8'));
  _auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return _auth;
}

// ── Drive helpers ─────────────────────────────────────────────────────────

export async function shareSheetPublic(sheetId: string): Promise<void> {
  const drive = google.drive({ version: 'v3', auth: getAuth() });
  await drive.permissions.create({
    fileId: sheetId,
    requestBody: { type: 'anyone', role: 'reader' },
    fields: 'id',
  });
}

// ── Admin sheet helpers ────────────────────────────────────────────────────

export async function appendToAdminSheet(tab: string, row: (string | number)[]): Promise<void> {
  const sheetId = process.env.ADMIN_SHEET_ID;
  if (!sheetId) throw new Error('ADMIN_SHEET_ID is not set in .env');
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row.map(String)] },
  });
}

// ── Queue tab ──────────────────────────────────────────────────────────────

export async function appendToQueue(
  discordUsername: string,
  addedBy: string,
  timestamp: string,
): Promise<void> {
  await appendToAdminSheet('Queue', [timestamp, discordUsername, addedBy]);
}

export async function removeFromQueueSheet(discordUsername: string): Promise<void> {
  const sheetId = process.env.ADMIN_SHEET_ID;
  if (!sheetId) return;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  // Find the row containing this username in column B (0-based index)
  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Queue!B:B',
  });
  const rows = valuesRes.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === discordUsername);
  if (rowIndex === -1) return;

  // Resolve the numeric sheet ID for the Queue tab
  const metaRes = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties',
  });
  const queueSheet = metaRes.data.sheets?.find((s) => s.properties?.title === 'Queue');
  if (queueSheet?.properties?.sheetId == null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: queueSheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });
}

// ── Message log tab ────────────────────────────────────────────────────────

export async function logMessage(
  messageId: number,
  senderUsername: string,
  recipientUsername: string,
  content: string,
  deliverAt: string,
  timestamp: string,
): Promise<void> {
  await appendToAdminSheet('Messages', [
    messageId,
    timestamp,
    senderUsername,
    recipientUsername,
    content,
    deliverAt,
  ]);
}

// ── Army sheet helpers ─────────────────────────────────────────────────────

export async function fetchArmyStats(sheetId: string): Promise<ArmySheetStats> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: ARMY_SHEET_CELLS.ALL_STATS,
  });
  return parseSheetStats((res.data.values ?? []) as (string | number | null)[][]);
}

export async function syncArmySheet(sheetId: string, stats: ArmySheetStats): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const data = [
    { range: ARMY_SHEET_CELLS.INFANTRY, values: [[stats.infantry]] },
    { range: ARMY_SHEET_CELLS.CAVALRY, values: [[stats.cavalry]] },
    { range: ARMY_SHEET_CELLS.WAGONS, values: [[stats.wagons]] },
    { range: ARMY_SHEET_CELLS.NONCOMBATANTS, values: [[stats.noncombatants]] },
    { range: ARMY_SHEET_CELLS.MORALE, values: [[stats.morale]] },
    { range: ARMY_SHEET_CELLS.RESTING_MORALE, values: [[stats.resting_morale]] },
    { range: ARMY_SHEET_CELLS.SUPPLIES, values: [[stats.supplies]] },
    { range: ARMY_SHEET_CELLS.COIN, values: [[stats.coin]] },
    { range: ARMY_SHEET_CELLS.GOODS, values: [[stats.goods]] },
    { range: ARMY_SHEET_CELLS.HEX, values: [[`${stats.hex_q},${stats.hex_r}`]] },
    { range: ARMY_SHEET_CELLS.STANCE, values: [[stats.stance]] },
    { range: ARMY_SHEET_CELLS.MAX_MORALE, values: [[stats.max_morale]] },
    { range: ARMY_SHEET_CELLS.FORCED_MARCH, values: [[stats.forced_march ? 1 : 0]] },
    { range: ARMY_SHEET_CELLS.NIGHT_MARCH, values: [[stats.night_march ? 1 : 0]] },
    // Infantry Strength, Cavalry Strength, Scouting Range (B13–B15) are sheet-calculated; not written.
  ];
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

export async function writeStance(sheetId: string, stance: 'allow_passage' | 'engage'): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: ARMY_SHEET_CELLS.STANCE,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[stance]] },
  });
}

export async function writePace(
  sheetId: string,
  forcedMarch: boolean,
  nightMarch: boolean,
): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: ARMY_SHEET_CELLS.FORCED_MARCH, values: [[forcedMarch ? 1 : 0]] },
        { range: ARMY_SHEET_CELLS.NIGHT_MARCH, values: [[nightMarch ? 1 : 0]] },
      ],
    },
  });
}

export async function syncAllArmySheets(
  commanders: CommanderRow[],
  armies: { id: number; commander_id: number }[],
  statsMap: Map<number, ArmySheetStats>,
): Promise<void> {
  const armyByCommander = new Map(armies.map((a) => [a.commander_id, a]));
  for (const commander of commanders) {
    if (!commander.army_sheet_url) continue;
    const army = armyByCommander.get(commander.id);
    if (!army) continue;
    const sheetId = extractSheetId(commander.army_sheet_url);
    if (!sheetId) continue;
    const stats = statsMap.get(army.id);
    if (!stats) continue;
    await syncArmySheet(sheetId, stats);
  }
}
