import { describe, expect, it, vi } from 'vitest';
import { QUEUE_TAB_HEADERS, checkQueueTab } from './sheet-checks.js';

function makeSheets({
  tabs = ['Queue'],
  headerRow = QUEUE_TAB_HEADERS,
}: {
  tabs?: string[];
  headerRow?: string[] | null;
} = {}) {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: tabs.map((title) => ({ properties: { title } })) },
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: headerRow ? [headerRow] : [] },
        }),
      },
    },
  };
}

describe('checkQueueTab', () => {
  it('passes when Queue tab exists with correct headers', async () => {
    const results = await checkQueueTab(makeSheets() as any, 'sheet-id');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('fails when Queue tab does not exist', async () => {
    const results = await checkQueueTab(makeSheets({ tabs: ['Messages'] }) as any, 'sheet-id');
    const tabCheck = results.find((r) => r.label.includes('"Queue" tab'));
    expect(tabCheck?.ok).toBe(false);
  });

  it('does not check headers when tab is missing', async () => {
    const sheets = makeSheets({ tabs: [] });
    const results = await checkQueueTab(sheets as any, 'sheet-id');
    expect(sheets.spreadsheets.values.get).not.toHaveBeenCalled();
  });

  it('fails when Queue tab has wrong headers', async () => {
    const results = await checkQueueTab(
      makeSheets({ headerRow: ['Wrong', 'Headers'] }) as any,
      'sheet-id',
    );
    const headerCheck = results.find((r) => r.label.includes('header'));
    expect(headerCheck?.ok).toBe(false);
  });

  it('fails when Queue tab is empty (no header row)', async () => {
    const results = await checkQueueTab(makeSheets({ headerRow: null }) as any, 'sheet-id');
    const headerCheck = results.find((r) => r.label.includes('header'));
    expect(headerCheck?.ok).toBe(false);
  });

  it('reports the found headers in the detail when wrong', async () => {
    const results = await checkQueueTab(
      makeSheets({ headerRow: ['A', 'B'] }) as any,
      'sheet-id',
    );
    const headerCheck = results.find((r) => r.label.includes('header'));
    expect(headerCheck?.detail).toContain('A, B');
  });
});
