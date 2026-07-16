import type { sheets_v4 } from 'googleapis';

type CheckResult = { label: string; ok: boolean; detail?: string };

// These must match the columns written by appendToQueue in sheets.ts
export const QUEUE_TAB_HEADERS = ['Timestamp', 'Discord Username', 'Added By'];

// These must match the columns written by logMessage in sheets.ts
export const MESSAGES_TAB_HEADERS = [
  'ID',
  'Timestamp',
  'Sender',
  'Recipient',
  'Content',
  'Deliver At',
];

// These must match the row order in ARMY_SHEET_CELLS in sheets.ts (rows 2–12, column A labels)
export const STATS_TAB_ROW_LABELS = [
  'Infantry',
  'Cavalry',
  'Wagons',
  'Noncombatants',
  'Morale',
  'Resting Morale',
  'Supplies',
  'Coin',
  'Goods',
  'Hex',
  'Stance',
];

export async function checkQueueTab(
  sheets: sheets_v4.Sheets,
  sheetId: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });

  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '');
  const tabExists = tabs.includes('Queue');

  results.push({
    label: 'Admin sheet has a "Queue" tab',
    ok: tabExists,
    detail: tabExists ? undefined : `found tabs: ${tabs.join(', ') || '(none)'}`,
  });

  if (!tabExists) return results;

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Queue!1:1',
  });

  const row: string[] = (headerRes.data.values ?? [])[0] ?? [];
  const expected = QUEUE_TAB_HEADERS;
  const headersMatch = expected.length === row.length && expected.every((h, i) => row[i] === h);

  results.push({
    label: `Queue tab has expected header row (${expected.join(', ')})`,
    ok: headersMatch,
    detail: headersMatch ? undefined : `found: ${row.join(', ') || '(empty)'}`,
  });

  return results;
}

export async function checkMessagesTab(
  sheets: sheets_v4.Sheets,
  sheetId: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });

  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '');
  const tabExists = tabs.includes('Messages');

  results.push({
    label: 'Admin sheet has a "Messages" tab',
    ok: tabExists,
    detail: tabExists ? undefined : `found tabs: ${tabs.join(', ') || '(none)'}`,
  });

  if (!tabExists) return results;

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Messages!1:1',
  });

  const row: string[] = (headerRes.data.values ?? [])[0] ?? [];
  const expected = MESSAGES_TAB_HEADERS;
  const headersMatch = expected.length === row.length && expected.every((h, i) => row[i] === h);

  results.push({
    label: `Messages tab has expected header row (${expected.join(', ')})`,
    ok: headersMatch,
    detail: headersMatch ? undefined : `found: ${row.join(', ') || '(empty)'}`,
  });

  return results;
}

export async function checkStatsTab(
  sheets: sheets_v4.Sheets,
  sheetId: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });

  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '');
  const tabExists = tabs.includes('Stats');

  results.push({
    label: 'Army sheet template has a "Stats" tab',
    ok: tabExists,
    detail: tabExists ? undefined : `found tabs: ${tabs.join(', ') || '(none)'}`,
  });

  if (!tabExists) return results;

  const labelRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Stats!A2:A12',
  });

  const rows = labelRes.data.values ?? [];
  const actualLabels = rows.map((r) => r[0] ?? '');
  const expected = STATS_TAB_ROW_LABELS;
  const labelsMatch =
    expected.length === actualLabels.length && expected.every((l, i) => actualLabels[i] === l);

  results.push({
    label: `Stats tab has expected row labels (${expected.join(', ')})`,
    ok: labelsMatch,
    detail: labelsMatch ? undefined : `found: ${actualLabels.join(', ') || '(empty)'}`,
  });

  return results;
}
