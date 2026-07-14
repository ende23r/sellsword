import { describe, expect, it } from 'vitest';
import { checkQueueRole } from './startup-check.js';

function makeGuild(roleNames: string[]) {
  return {
    roles: {
      cache: {
        find: (fn: (r: { name: string }) => boolean) =>
          roleNames.map((name) => ({ name })).find(fn),
      },
    },
  };
}

describe('checkQueueRole', () => {
  it('passes when the Queued role exists', () => {
    const result = checkQueueRole(makeGuild(['Admin', 'Queued', 'Player']) as any);
    expect(result.ok).toBe(true);
  });

  it('fails when the Queued role does not exist', () => {
    const result = checkQueueRole(makeGuild(['Admin', 'Player']) as any);
    expect(result.ok).toBe(false);
  });

  it('includes setup instructions in the detail when failing', () => {
    const result = checkQueueRole(makeGuild([]) as any);
    expect(result.detail).toBeTruthy();
  });
});
