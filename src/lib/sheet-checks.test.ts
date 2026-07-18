import { describe, expect, it, vi } from 'vitest';
import { STAT_RANGE_NAMES } from './sheets.js';
import {
  MESSAGES_TAB_HEADERS,
  QUEUE_TAB_HEADERS,
  checkMessagesTab,
  checkQueueTab,
  checkStatsNamedRanges,
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
    await checkQueueTab(sheets as any, 'sheet-id');
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

// ── Stats named ranges ────────────────────────────────────────────────────────

function makeNamedRangeSheets(names: string[]) {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { namedRanges: names.map((name) => ({ name })) },
      }),
    },
  };
}

describe('checkStatsNamedRanges', () => {
  it('passes when every stat named range is defined', async () => {
    const results = await checkStatsNamedRanges(
      makeNamedRangeSheets([...STAT_RANGE_NAMES]) as any,
      'sheet-id',
    );
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  it('ignores extra named ranges', async () => {
    const results = await checkStatsNamedRanges(
      makeNamedRangeSheets([...STAT_RANGE_NAMES, 'gm_notes']) as any,
      'sheet-id',
    );
    expect(results[0].ok).toBe(true);
  });

  it('fails and lists the missing names', async () => {
    const defined = STAT_RANGE_NAMES.filter((n) => n !== 'morale' && n !== 'hex');
    const results = await checkStatsNamedRanges(
      makeNamedRangeSheets(defined) as any,
      'sheet-id',
    );
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('morale');
    expect(results[0].detail).toContain('hex');
  });

  it('fails when the sheet has no named ranges at all', async () => {
    const results = await checkStatsNamedRanges(makeNamedRangeSheets([]) as any, 'sheet-id');
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('detachments');
  });
});
