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

// Every army sheet must define these named ranges (Data → Named ranges in the
// Sheets UI), each covering the single cell that holds that stat. Names match
// the ArmySheetStats keys exactly. GMs are free to lay the sheet out however
// they like — named ranges follow their cell when rows or columns move, so
// this is the whole contract between the bot and the sheet.
export const STAT_RANGE_NAMES = [
  'infantry',
  'cavalry',
  'wagons',
  'noncombatants',
  'morale',
  'resting_morale',
  'supplies',
  'coin',
  'goods',
  'hex',
  'stance',
  'infantry_strength',
  'cavalry_strength',
  'scouting_range',
  'max_morale',
  'forced_march',
  'night_march',
] as const;

export type StatRangeName = (typeof STAT_RANGE_NAMES)[number];
export type StatCells = Partial<Record<StatRangeName, string | number | null>>;

export function missingStatRanges(definedNames: string[]): StatRangeName[] {
  return STAT_RANGE_NAMES.filter((name) => !definedNames.includes(name));
}

export function parseSheetStats(cells: StatCells): ArmySheetStats {
  type RawCell = string | number | null | undefined;
  const num = (v: RawCell, fallback: number): number => {
    const n = Number(v);
    return v !== null && v !== undefined && v !== '' && !isNaN(n) ? Math.round(n) : fallback;
  };
  const bool = (v: RawCell): boolean => {
    if (v === null || v === undefined || v === '') return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  };
  const stance = (v: RawCell): 'allow_passage' | 'engage' => {
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'engage' || s === 'block' ? 'engage' : 'allow_passage';
  };
  // Empty cell means a fresh sheet (position not set yet) — default to (0,0).
  // Anything else must parse exactly, so a GM's typo is reported instead of
  // silently landing the army on hex (0,0).
  const parseHex = (v: RawCell): { q: number; r: number } => {
    const raw = String(v ?? '').trim();
    if (raw === '') return { q: 0, r: 0 };
    const match = raw.match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    if (!match) {
      throw new Error(`Hex cell "${raw}" is invalid — expected "q,r" (e.g. "3,-2").`);
    }
    return { q: parseInt(match[1], 10), r: parseInt(match[2], 10) };
  };

  const hex = parseHex(cells.hex);

  return {
    infantry: num(cells.infantry, 0),
    cavalry: num(cells.cavalry, 0),
    wagons: num(cells.wagons, 0),
    noncombatants: num(cells.noncombatants, 0),
    morale: num(cells.morale, 9),
    resting_morale: num(cells.resting_morale, 9),
    supplies: num(cells.supplies, 0),
    coin: num(cells.coin, 0),
    goods: num(cells.goods, 0),
    hex_q: hex.q,
    hex_r: hex.r,
    stance: stance(cells.stance),
    infantry_strength: num(cells.infantry_strength, 0),
    cavalry_strength: num(cells.cavalry_strength, 0),
    scouting_range: num(cells.scouting_range, 1),
    max_morale: num(cells.max_morale, 12),
    forced_march: bool(cells.forced_march),
    night_march: bool(cells.night_march),
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

export async function fetchDefinedRangeNames(sheetId: string): Promise<string[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'namedRanges.name',
  });
  return (meta.data.namedRanges ?? []).map((nr) => nr.name ?? '');
}

export async function fetchArmyStats(sheetId: string): Promise<ArmySheetStats> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  let res;
  try {
    res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [...STAT_RANGE_NAMES],
    });
  } catch (err) {
    // A missing named range fails the whole batch with an unhelpful "Unable to
    // parse range" — enumerate the sheet's named ranges to name the culprits.
    const missing = missingStatRanges(await fetchDefinedRangeNames(sheetId));
    if (missing.length > 0) {
      throw new Error(
        `Army sheet is missing named ranges: ${missing.join(', ')}. Define them via Data → Named ranges.`,
        { cause: err },
      );
    }
    throw err;
  }

  const cells: StatCells = {};
  const valueRanges = res.data.valueRanges ?? [];
  STAT_RANGE_NAMES.forEach((name, i) => {
    cells[name] = (valueRanges[i]?.values?.[0]?.[0] ?? null) as string | number | null;
  });
  return parseSheetStats(cells);
}

export function statWriteData(
  stats: ArmySheetStats,
): { range: StatRangeName; values: (string | number)[][] }[] {
  return [
    { range: 'infantry', values: [[stats.infantry]] },
    { range: 'cavalry', values: [[stats.cavalry]] },
    { range: 'wagons', values: [[stats.wagons]] },
    { range: 'noncombatants', values: [[stats.noncombatants]] },
    { range: 'morale', values: [[stats.morale]] },
    { range: 'resting_morale', values: [[stats.resting_morale]] },
    { range: 'supplies', values: [[stats.supplies]] },
    { range: 'coin', values: [[stats.coin]] },
    { range: 'goods', values: [[stats.goods]] },
    { range: 'hex', values: [[`${stats.hex_q},${stats.hex_r}`]] },
    { range: 'stance', values: [[stats.stance]] },
    { range: 'max_morale', values: [[stats.max_morale]] },
    { range: 'forced_march', values: [[stats.forced_march ? 1 : 0]] },
    { range: 'night_march', values: [[stats.night_march ? 1 : 0]] },
    // infantry_strength, cavalry_strength, scouting_range are sheet-calculated; not written.
  ];
}

export async function syncArmySheet(sheetId: string, stats: ArmySheetStats): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: statWriteData(stats) },
  });
}

export async function writeStance(sheetId: string, stance: 'allow_passage' | 'engage'): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'stance',
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
        { range: 'forced_march', values: [[forcedMarch ? 1 : 0]] },
        { range: 'night_march', values: [[nightMarch ? 1 : 0]] },
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
