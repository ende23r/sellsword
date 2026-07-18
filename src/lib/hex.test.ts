import { describe, expect, it } from 'vitest';
import { computeDeliveryTick, formatHex, lastTickBefore, nextTickAfter } from './hex.js';

// All tests use 'UTC' so tick times are exactly 06:00Z, 14:00Z, 22:00Z — no DST noise.

const D = (s: string) => new Date(s);

describe('formatHex', () => {
  it('formats positive coordinates', () => {
    expect(formatHex(3, 5)).toBe('(3,5)');
  });

  it('uses a typographic minus for negative r', () => {
    expect(formatHex(3, -5)).toBe('(3,−5)');
  });
});

describe('lastTickBefore', () => {
  it('returns the 06:00 tick when now is just after it', () => {
    expect(lastTickBefore(D('2026-07-14T07:00:00Z'), 'UTC')).toEqual(D('2026-07-14T06:00:00Z'));
  });

  it('returns the tick itself when now is exactly at a tick', () => {
    expect(lastTickBefore(D('2026-07-14T06:00:00Z'), 'UTC')).toEqual(D('2026-07-14T06:00:00Z'));
    expect(lastTickBefore(D('2026-07-14T14:00:00Z'), 'UTC')).toEqual(D('2026-07-14T14:00:00Z'));
    expect(lastTickBefore(D('2026-07-14T22:00:00Z'), 'UTC')).toEqual(D('2026-07-14T22:00:00Z'));
  });

  it('returns the 14:00 tick when now is between 14:00 and 22:00', () => {
    expect(lastTickBefore(D('2026-07-14T17:30:00Z'), 'UTC')).toEqual(D('2026-07-14T14:00:00Z'));
  });

  it('returns the 22:00 tick from the previous day when now is before 06:00', () => {
    expect(lastTickBefore(D('2026-07-14T03:00:00Z'), 'UTC')).toEqual(D('2026-07-13T22:00:00Z'));
  });
});

describe('nextTickAfter', () => {
  it('returns the 14:00 tick when t is at 06:00', () => {
    expect(nextTickAfter(D('2026-07-14T06:00:00Z'), 'UTC')).toEqual(D('2026-07-14T14:00:00Z'));
  });

  it('returns the 22:00 tick when t is between 14:00 and 22:00', () => {
    expect(nextTickAfter(D('2026-07-14T18:00:00Z'), 'UTC')).toEqual(D('2026-07-14T22:00:00Z'));
  });

  it('returns the next day 06:00 tick when t is at 22:00', () => {
    expect(nextTickAfter(D('2026-07-14T22:00:00Z'), 'UTC')).toEqual(D('2026-07-15T06:00:00Z'));
  });

  it('returns the next day 06:00 tick when t is just before midnight', () => {
    expect(nextTickAfter(D('2026-07-14T23:59:00Z'), 'UTC')).toEqual(D('2026-07-15T06:00:00Z'));
  });
});

describe('computeDeliveryTick', () => {
  it('delivers at the exact arrival hour when arrival falls on a whole hour', () => {
    // now=07:00Z, 2 hexes × 3h = 6h → arrives 13:00Z → delivers 13:00Z
    expect(computeDeliveryTick(2, D('2026-07-14T07:00:00Z'))).toEqual(D('2026-07-14T13:00:00Z'));
  });

  it('snaps up to the next whole hour when arrival is mid-hour', () => {
    // now=07:30Z + 6h = 13:30Z → snaps to 14:00Z
    expect(computeDeliveryTick(2, D('2026-07-14T07:30:00Z'))).toEqual(D('2026-07-14T14:00:00Z'));
  });

  it('uses 4 hours per hex for hostile territory', () => {
    // 2 hexes × 4h = 8h, from 07:00Z → delivers 15:00Z
    expect(computeDeliveryTick(2, D('2026-07-14T07:00:00Z'), true)).toEqual(
      D('2026-07-14T15:00:00Z'),
    );
  });

  it('snaps to next hour for 0-hex distance when sent mid-hour', () => {
    // 0h travel from 07:30Z → snaps to 08:00Z
    expect(computeDeliveryTick(0, D('2026-07-14T07:30:00Z'))).toEqual(D('2026-07-14T08:00:00Z'));
  });

  it('delivers at current hour for 0-hex distance sent on an exact hour', () => {
    expect(computeDeliveryTick(0, D('2026-07-14T07:00:00Z'))).toEqual(D('2026-07-14T07:00:00Z'));
  });
});
