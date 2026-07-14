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
import type { ArmyRow, CommanderRow } from './db.js';

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

// ── Message log tab ────────────────────────────────────────────────────────

export async function logMessage(
  senderUsername: string,
  recipientUsername: string,
  content: string,
  deliverAt: string,
  timestamp: string,
): Promise<void> {
  await appendToAdminSheet('Messages', [
    timestamp,
    senderUsername,
    recipientUsername,
    content,
    deliverAt,
  ]);
}

// ── Army sheet helpers ─────────────────────────────────────────────────────

// TODO(eric): Update these cell references to match your army sheet template.
// The bot writes army stats to these named cells on the "Stats" tab.
const ARMY_SHEET_CELLS = {
  INFANTRY: 'Stats!B2',
  CAVALRY: 'Stats!B3',
  WAGONS: 'Stats!B4',
  NONCOMBATANTS: 'Stats!B5',
  MORALE: 'Stats!B6',
  RESTING_MORALE: 'Stats!B7',
  SUPPLIES: 'Stats!B8',
  COIN: 'Stats!B9',
  GOODS: 'Stats!B10',
  HEX: 'Stats!B11',
  STANCE: 'Stats!B12',
};

export async function syncArmySheet(sheetId: string, army: ArmyRow): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const data = [
    { range: ARMY_SHEET_CELLS.INFANTRY, values: [[army.infantry]] },
    { range: ARMY_SHEET_CELLS.CAVALRY, values: [[army.cavalry]] },
    { range: ARMY_SHEET_CELLS.WAGONS, values: [[army.wagons]] },
    { range: ARMY_SHEET_CELLS.NONCOMBATANTS, values: [[army.noncombatants]] },
    { range: ARMY_SHEET_CELLS.MORALE, values: [[army.morale]] },
    { range: ARMY_SHEET_CELLS.RESTING_MORALE, values: [[army.resting_morale]] },
    { range: ARMY_SHEET_CELLS.SUPPLIES, values: [[army.supplies]] },
    { range: ARMY_SHEET_CELLS.COIN, values: [[army.coin]] },
    { range: ARMY_SHEET_CELLS.GOODS, values: [[army.goods]] },
    { range: ARMY_SHEET_CELLS.HEX, values: [[`${army.hex_q},${army.hex_r}`]] },
    { range: ARMY_SHEET_CELLS.STANCE, values: [[army.stance]] },
  ];
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

// ── Commission: copy template and make it public ───────────────────────────

export async function copyArmySheetTemplate(commanderName: string): Promise<{
  sheetId: string;
  url: string;
}> {
  const templateId = process.env.ARMY_SHEET_TEMPLATE_ID;
  if (!templateId) throw new Error('ARMY_SHEET_TEMPLATE_ID is not set in .env');

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const copy = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: `Army Sheet — ${commanderName}` },
  });
  const sheetId = copy.data.id!;

  await drive.permissions.create({
    fileId: sheetId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

export async function syncAllArmySheets(
  commanders: CommanderRow[],
  armies: ArmyRow[],
): Promise<void> {
  const armyByCommander = new Map(armies.map((a) => [a.commander_id, a]));
  for (const commander of commanders) {
    if (!commander.army_sheet_url) continue;
    const army = armyByCommander.get(commander.id);
    if (!army) continue;
    // Extract sheet ID from URL
    const match = commander.army_sheet_url.match(/\/d\/([^/]+)/);
    if (!match) continue;
    await syncArmySheet(match[1], army);
  }
}
