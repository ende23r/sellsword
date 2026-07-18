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

// One row of a sheet's detachment tables. Multiplier (daily supplies eaten
// per soldier; defaults to 1 for infantry rows and 10 for cavalry rows) and
// strength are explicit rather than derived from a type, so GMs can invent
// custom detachment types without bot changes; notes is free text for type,
// honors, and anything else.
export type Detachment = {
  name: string;
  size: number;
  notes: string;
  multiplier: number;
  strength: number;
  wagons: number;
};

// One row of the sheet's goods table: a named kind of good and how much of
// it the army carries, measured on the same scale as supplies.
export type Good = {
  name: string;
  count: number;
};

export type ArmySheetStats = {
  // Composition (GM-owned; the bot reads and derives totals, never writes).
  // Infantry and cavalry are separate tables because the rules treat them
  // differently (supply upkeep, scouting, forced-march speed).
  infantry_detachments: Detachment[];
  cavalry_detachments: Detachment[];
  noncombatants: number;
  // Resources (goods is a GM-owned table like the detachments)
  morale: number;
  resting_morale: number;
  supplies: number;
  coin: number;
  goods: Good[];
  // Position (source of truth; written to hex cell as "q,r")
  hex_q: number;
  hex_r: number;
  // State
  stance: 'allow_passage' | 'engage';
  // Sheet-calculated (bot reads only)
  scouting_range: number;
  // Additional stats
  max_morale: number;
  forced_march: boolean;
  night_march: boolean;
};

// ── Derived totals ────────────────────────────────────────────────────────────

type Composition = Pick<ArmySheetStats, 'infantry_detachments' | 'cavalry_detachments'>;

function allDetachments(stats: Composition): Detachment[] {
  return [...stats.infantry_detachments, ...stats.cavalry_detachments];
}

export function totalWagons(stats: Composition): number {
  return allDetachments(stats).reduce((sum, d) => sum + d.wagons, 0);
}

export function totalStrength(stats: Composition): number {
  return allDetachments(stats).reduce((sum, d) => sum + d.strength, 0);
}

export function supplyUpkeep(stats: Composition): number {
  return Math.round(allDetachments(stats).reduce((sum, d) => sum + d.size * d.multiplier, 0));
}

export function isCavalryOnly(stats: Composition): boolean {
  return (
    stats.cavalry_detachments.length > 0 &&
    stats.infantry_detachments.length === 0 &&
    totalWagons(stats) === 0
  );
}

export function totalGoods(stats: Pick<ArmySheetStats, 'goods'>): number {
  return stats.goods.reduce((sum, g) => sum + g.count, 0);
}

// Every army sheet must define these named ranges (Data → Named ranges in the
// Sheets UI). Each scalar range covers the single cell that holds that stat.
// The table ranges — `infantry_detachments`, `cavalry_detachments`
// (columns name | size | notes | multiplier | strength | wagons) and `goods`
// (columns name | count) — cover their table's data rows, header excluded;
// draw them generously downward, since only rows with a positive size/count
// register. GMs are free to lay the sheet out however they like — named
// ranges follow their cell when rows or columns move, so this is the whole
// contract between the bot and the sheet.
export const SCALAR_RANGE_NAMES = [
  'noncombatants',
  'morale',
  'resting_morale',
  'supplies',
  'coin',
  'hex',
  'stance',
  'scouting_range',
  'max_morale',
  'forced_march',
  'night_march',
] as const;

export const STAT_RANGE_NAMES = [
  ...SCALAR_RANGE_NAMES,
  'infantry_detachments',
  'cavalry_detachments',
  'goods',
] as const;

export type ScalarRangeName = (typeof SCALAR_RANGE_NAMES)[number];
export type StatRangeName = (typeof STAT_RANGE_NAMES)[number];
export type StatCells = Partial<Record<ScalarRangeName, string | number | null>>;

export function missingStatRanges(definedNames: string[]): StatRangeName[] {
  return STAT_RANGE_NAMES.filter((name) => !definedNames.includes(name));
}

type RawCell = string | number | null | undefined;

const blank = (v: RawCell): boolean => v === null || v === undefined || String(v).trim() === '';

export function parseDetachments(
  rows: RawCell[][],
  tableLabel: string,
  defaultMultiplier: number,
): Detachment[] {
  const detachments: Detachment[] = [];

  rows.forEach((row, i) => {
    const [name, size, notes, multiplier, strength, wagons] = [0, 1, 2, 3, 4, 5].map((c) => row[c]);
    const label = `${tableLabel} detachment row ${i + 1} ("${String(name ?? '').trim() || 'unnamed'}")`;

    // Template rows may keep a default multiplier and a strength formula even
    // when unused, so a positive size is what marks a real detachment. A named
    // row with a blank size is still an error (almost certainly a mistake);
    // size 0 explicitly disables a row.
    if (blank(size)) {
      if (!blank(name)) throw new Error(`${label}: size is required.`);
      return;
    }
    const sizeNum = Number(size);
    if (isNaN(sizeNum) || sizeNum < 0) {
      throw new Error(`${label}: size "${String(size).trim()}" is not a valid number.`);
    }
    if (sizeNum === 0) return;

    const numCol = (v: RawCell, col: string, fallback: number): number => {
      if (blank(v)) return fallback;
      const n = Number(v);
      if (isNaN(n) || n < 0) throw new Error(`${label}: ${col} "${String(v).trim()}" is not a valid number.`);
      return n;
    };

    detachments.push({
      name: String(name ?? '').trim(),
      size: Math.round(sizeNum),
      notes: String(notes ?? '').trim(),
      multiplier: numCol(multiplier, 'multiplier', defaultMultiplier),
      strength: Math.round(numCol(strength, 'strength', 0)),
      wagons: Math.round(numCol(wagons, 'wagons', 0)),
    });
  });

  return detachments;
}

// Goods rows follow the same gating as detachments: a positive count marks a
// real row, 0 explicitly disables one, and a named row with a blank count is
// an error.
export function parseGoods(rows: RawCell[][]): Good[] {
  const goods: Good[] = [];

  rows.forEach((row, i) => {
    const [name, count] = [row[0], row[1]];
    const label = `Goods row ${i + 1} ("${String(name ?? '').trim() || 'unnamed'}")`;

    if (blank(count)) {
      if (!blank(name)) throw new Error(`${label}: count is required.`);
      return;
    }
    const countNum = Number(count);
    if (isNaN(countNum) || countNum < 0) {
      throw new Error(`${label}: count "${String(count).trim()}" is not a valid number.`);
    }
    if (countNum === 0) return;

    goods.push({ name: String(name ?? '').trim(), count: Math.round(countNum) });
  });

  return goods;
}

// ── Demands (admin sheet "Demands" tab) ───────────────────────────────────────

// A market for one good in one hex: the price paid per unit, and the volume
// (units/day) the market absorbs — split evenly among all armies selling that
// good there. GMs edit the tab live, so bad rows produce warnings for the
// tick log rather than errors that would abort processing.
export type Demand = {
  hex_q: number;
  hex_r: number;
  good: string;
  price: number;
  volume: number;
};

export function parseDemands(rows: RawCell[][]): { demands: Demand[]; warnings: string[] } {
  const demands: Demand[] = [];
  const warnings: string[] = [];

  rows.forEach((row, i) => {
    const [hex, good, price, volume] = [row[0], row[1], row[2], row[3]];
    if ([hex, good, price, volume].every(blank)) return;

    const skip = (why: string) => warnings.push(`⚠️ Demands row ${i + 1}: ${why} — row skipped.`);

    const hexMatch = String(hex ?? '')
      .trim()
      .match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    if (!hexMatch) return skip(`hex "${String(hex ?? '').trim()}" is not "q,r"`);

    const goodName = String(good ?? '').trim();
    if (!goodName) return skip('good name is missing');

    const priceNum = Number(price);
    if (blank(price) || isNaN(priceNum) || priceNum < 0)
      return skip(`price "${String(price ?? '').trim()}" is not a valid number`);

    const volumeNum = Number(volume);
    if (blank(volume) || isNaN(volumeNum) || volumeNum <= 0)
      return skip(`volume "${String(volume ?? '').trim()}" is not a valid number`);

    demands.push({
      hex_q: parseInt(hexMatch[1], 10),
      hex_r: parseInt(hexMatch[2], 10),
      good: goodName,
      price: priceNum,
      volume: Math.round(volumeNum),
    });
  });

  return { demands, warnings };
}

export function parseSheetStats(
  cells: StatCells,
  infantryRows: RawCell[][],
  cavalryRows: RawCell[][],
  goodsRows: RawCell[][],
): ArmySheetStats {
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
    infantry_detachments: parseDetachments(infantryRows, 'Infantry', 1),
    cavalry_detachments: parseDetachments(cavalryRows, 'Cavalry', 10),
    noncombatants: num(cells.noncombatants, 0),
    morale: num(cells.morale, 9),
    resting_morale: num(cells.resting_morale, 9),
    supplies: num(cells.supplies, 0),
    coin: num(cells.coin, 0),
    goods: parseGoods(goodsRows),
    hex_q: hex.q,
    hex_r: hex.r,
    stance: stance(cells.stance),
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

// ── Demands tab ────────────────────────────────────────────────────────────

export async function fetchDemands(): Promise<{ demands: Demand[]; warnings: string[] }> {
  const sheetId = process.env.ADMIN_SHEET_ID;
  if (!sheetId) throw new Error('ADMIN_SHEET_ID is not set in .env');
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Demands!A2:D',
  });
  return parseDemands((res.data.values ?? []) as RawCell[][]);
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
  SCALAR_RANGE_NAMES.forEach((name, i) => {
    cells[name] = (valueRanges[i]?.values?.[0]?.[0] ?? null) as string | number | null;
  });
  // The table ranges are requested last, after the scalars.
  const infantryRows = (valueRanges[SCALAR_RANGE_NAMES.length]?.values ?? []) as RawCell[][];
  const cavalryRows = (valueRanges[SCALAR_RANGE_NAMES.length + 1]?.values ?? []) as RawCell[][];
  const goodsRows = (valueRanges[SCALAR_RANGE_NAMES.length + 2]?.values ?? []) as RawCell[][];
  return parseSheetStats(cells, infantryRows, cavalryRows, goodsRows);
}

// The ranges the bot owns and writes back. Everything else — the detachment
// and goods tables, noncombatants, resting_morale, max_morale, scouting_range
// — is GM-owned: the bot reads it but never writes, so GM edits are never
// clobbered.
export function statWriteData(
  stats: ArmySheetStats,
): { range: StatRangeName; values: (string | number)[][] }[] {
  return [
    { range: 'morale', values: [[stats.morale]] },
    { range: 'supplies', values: [[stats.supplies]] },
    { range: 'coin', values: [[stats.coin]] },
    { range: 'hex', values: [[`${stats.hex_q},${stats.hex_r}`]] },
    { range: 'stance', values: [[stats.stance]] },
    { range: 'forced_march', values: [[stats.forced_march ? 1 : 0]] },
    { range: 'night_march', values: [[stats.night_march ? 1 : 0]] },
  ];
}

// Rewrites the goods named range: clear the whole range first so rows that
// sold out disappear, then write the remaining name | count rows.
export async function writeGoods(sheetId: string, goods: Good[]): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: 'goods' });
  if (goods.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'goods',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: goods.map((g) => [g.name, g.count]) },
  });
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
