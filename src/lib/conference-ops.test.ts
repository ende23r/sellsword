import { describe, expect, it } from 'vitest';
import { conferenceChannelName } from './conference-ops.js';

describe('conferenceChannelName', () => {
  it('uses slugified stronghold name when provided', () => {
    expect(conferenceChannelName(3, 5, 'Castle Bravia')).toBe('conf-castle-bravia');
  });

  it('uses hex coords when no stronghold', () => {
    expect(conferenceChannelName(3, 5)).toBe('conf-3-5');
  });

  it('encodes negative r with n prefix to avoid double-hyphen', () => {
    expect(conferenceChannelName(2, -7)).toBe('conf-2-n7');
  });

  it('handles negative q too', () => {
    expect(conferenceChannelName(-1, -3)).toBe('conf-n1-n3');
  });

  it('strips special characters from stronghold name', () => {
    expect(conferenceChannelName(0, 0, "St. Rémy's Keep")).toBe('conf-st-r-my-s-keep');
  });

  it('null stronghold name falls back to coords', () => {
    expect(conferenceChannelName(1, 2, null)).toBe('conf-1-2');
  });
});
