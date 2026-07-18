import type { sheets_v4 } from 'googleapis';
import { STAT_RANGE_NAMES, missingStatRanges } from './sheets.js';

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

// These must match the columns read by fetchDemands/parseDemands in sheets.ts
export const DEMANDS_TAB_HEADERS = ['Hex', 'Good', 'Price', 'Volume'];

export async function checkDemandsTab(
  sheets: sheets_v4.Sheets,
  sheetId: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });

  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '');
  const tabExists = tabs.includes('Demands');

  results.push({
    label: 'Admin sheet has a "Demands" tab',
    ok: tabExists,
    detail: tabExists ? undefined : `found tabs: ${tabs.join(', ') || '(none)'}`,
  });

  if (!tabExists) return results;

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Demands!1:1',
  });

  const row: string[] = (headerRes.data.values ?? [])[0] ?? [];
  const expected = DEMANDS_TAB_HEADERS;
  const headersMatch = expected.length === row.length && expected.every((h, i) => row[i] === h);

  results.push({
    label: `Demands tab has expected header row (${expected.join(', ')})`,
    ok: headersMatch,
    detail: headersMatch ? undefined : `found: ${row.join(', ') || '(empty)'}`,
  });

  return results;
}

export async function checkStatsNamedRanges(
  sheets: sheets_v4.Sheets,
  sheetId: string,
): Promise<CheckResult[]> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'namedRanges.name',
  });

  const defined = (meta.data.namedRanges ?? []).map((nr) => nr.name ?? '');
  const missing = missingStatRanges(defined);

  return [
    {
      label: `Army sheet defines all ${STAT_RANGE_NAMES.length} stat named ranges`,
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? undefined
          : `missing: ${missing.join(', ')} — define them via Data → Named ranges`,
    },
  ];
}
