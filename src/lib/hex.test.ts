import { describe, expect, it } from 'vitest';
import { computeDeliveryTick, lastTickBefore, nextTickAfter } from './hex.js';

// All tests use 'UTC' so tick times are exactly 06:00Z, 14:00Z, 22:00Z — no DST noise.

const D = (s: string) => new Date(s);

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
  // now = Jul 14 07:00Z → last tick = Jul 14 06:00Z

  it('2 hexes (6h travel) arrives at noon, delivers at 14:00 tick', () => {
    expect(computeDeliveryTick(2, D('2026-07-14T07:00:00Z'), 'UTC')).toEqual(
      D('2026-07-14T14:00:00Z'),
    );
  });

  it('5 hexes (15h travel) arrives at 21:00, delivers at 22:00 tick', () => {
    expect(computeDeliveryTick(5, D('2026-07-14T07:00:00Z'), 'UTC')).toEqual(
      D('2026-07-14T22:00:00Z'),
    );
  });

  it('8 hexes (24h travel) arrives at 06:00 next day, delivers at 14:00 next day', () => {
    expect(computeDeliveryTick(8, D('2026-07-14T07:00:00Z'), 'UTC')).toEqual(
      D('2026-07-15T14:00:00Z'),
    );
  });

  it('grants the last-tick grace: sending just before a tick is the same as just after', () => {
    // 1 minute before 14:00 tick → last tick = 06:00 (same start as being 1 min after 06:00)
    const beforeTick = computeDeliveryTick(2, D('2026-07-14T13:59:00Z'), 'UTC');
    const afterTick = computeDeliveryTick(2, D('2026-07-14T07:00:00Z'), 'UTC');
    expect(beforeTick).toEqual(afterTick);
  });

  it('sending exactly at a tick uses that tick as the start', () => {
    // now = 06:00Z exactly → last tick = 06:00Z → same result as just after
    expect(computeDeliveryTick(2, D('2026-07-14T06:00:00Z'), 'UTC')).toEqual(
      D('2026-07-14T14:00:00Z'),
    );
  });
});
