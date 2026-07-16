import { describe, expect, it, vi } from 'vitest';
import {
  MESSAGES_TAB_HEADERS,
  QUEUE_TAB_HEADERS,
  STATS_TAB_ROW_LABELS,
  checkMessagesTab,
  checkQueueTab,
  checkStatsTab,
} from './sheet-checks.js';

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

// ── Messages tab ─────────────────────────────────────────────────────────────

function makeMessagesSheets({
  tabs = ['Queue', 'Messages'],
  headerRow = MESSAGES_TAB_HEADERS,
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

describe('checkMessagesTab', () => {
  it('passes when Messages tab exists with correct headers', async () => {
    const results = await checkMessagesTab(makeMessagesSheets() as any, 'sheet-id');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('fails when Messages tab does not exist', async () => {
    const results = await checkMessagesTab(
      makeMessagesSheets({ tabs: ['Queue'] }) as any,
      'sheet-id',
    );
    const tabCheck = results.find((r) => r.label.includes('"Messages" tab'));
    expect(tabCheck?.ok).toBe(false);
  });

  it('does not check headers when tab is missing', async () => {
    const sheets = makeMessagesSheets({ tabs: [] });
    await checkMessagesTab(sheets as any, 'sheet-id');
    expect(sheets.spreadsheets.values.get).not.toHaveBeenCalled();
  });

  it('fails when Messages tab has wrong headers', async () => {
    const results = await checkMessagesTab(
      makeMessagesSheets({ headerRow: ['Wrong', 'Headers'] }) as any,
      'sheet-id',
    );
    const headerCheck = results.find((r) => r.label.includes('header'));
    expect(headerCheck?.ok).toBe(false);
  });

  it('fails when Messages tab is missing the ID column', async () => {
    const results = await checkMessagesTab(
      makeMessagesSheets({ headerRow: ['Timestamp', 'Sender', 'Recipient', 'Content', 'Deliver At'] }) as any,
      'sheet-id',
    );
    const headerCheck = results.find((r) => r.label.includes('header'));
    expect(headerCheck?.ok).toBe(false);
  });
});

// ── Stats tab ─────────────────────────────────────────────────────────────────

function makeStatsSheets({
  tabs = ['Stats'],
  rowLabels = STATS_TAB_ROW_LABELS,
}: {
  tabs?: string[];
  rowLabels?: string[] | null;
} = {}) {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: tabs.map((title) => ({ properties: { title } })) },
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: rowLabels ? rowLabels.map((l) => [l]) : [] },
        }),
      },
    },
  };
}

describe('checkStatsTab', () => {
  it('passes when Stats tab exists with correct row labels', async () => {
    const results = await checkStatsTab(makeStatsSheets() as any, 'sheet-id');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('fails when Stats tab does not exist', async () => {
    const results = await checkStatsTab(
      makeStatsSheets({ tabs: ['Sheet1'] }) as any,
      'sheet-id',
    );
    const tabCheck = results.find((r) => r.label.includes('"Stats" tab'));
    expect(tabCheck?.ok).toBe(false);
  });

  it('does not check labels when tab is missing', async () => {
    const sheets = makeStatsSheets({ tabs: [] });
    await checkStatsTab(sheets as any, 'sheet-id');
    expect(sheets.spreadsheets.values.get).not.toHaveBeenCalled();
  });

  it('fails when row labels do not match', async () => {
    const results = await checkStatsTab(
      makeStatsSheets({ rowLabels: ['Wrong', 'Labels'] }) as any,
      'sheet-id',
    );
    const labelCheck = results.find((r) => r.label.includes('row labels'));
    expect(labelCheck?.ok).toBe(false);
  });

  it('fails when Stats tab is empty', async () => {
    const results = await checkStatsTab(makeStatsSheets({ rowLabels: null }) as any, 'sheet-id');
    const labelCheck = results.find((r) => r.label.includes('row labels'));
    expect(labelCheck?.ok).toBe(false);
  });

  it('reports the found labels in the detail when wrong', async () => {
    const results = await checkStatsTab(
      makeStatsSheets({ rowLabels: ['A', 'B'] }) as any,
      'sheet-id',
    );
    const labelCheck = results.find((r) => r.label.includes('row labels'));
    expect(labelCheck?.detail).toContain('A, B');
  });
});
