import type { sheets_v4 } from 'googleapis';

type CheckResult = { label: string; ok: boolean; detail?: string };

// These must match the columns written by appendToQueue in sheets.ts
export const QUEUE_TAB_HEADERS = ['Timestamp', 'Discord Username', 'Added By'];

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
