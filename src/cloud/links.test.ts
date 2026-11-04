import { describe, expect, it } from 'vitest';
import { cloudDisplayState, type CloudLink } from './links';
const link: CloudLink = { localId: 'synthetic-local', userId: 'synthetic-user', cloudId: 'synthetic-cloud', cloudRevision: 4, syncedLocalRevision: 2, state: 'synced', error: null };
describe('cloud save indicators', () => {
  it('shows pending immediately while local edits are dirty, before the upload debounce starts', () => { expect(cloudDisplayState(link, 2, true)).toBe('pending'); });
  it('keeps showing pending after the local save until the cloud acknowledgement catches up', () => { expect(cloudDisplayState(link, 3, false)).toBe('pending'); expect(cloudDisplayState({ ...link, syncedLocalRevision: 3 }, 3, false)).toBe('synced'); });
  it('keeps explicit local documents local and preserves cloud error/conflict indicators', () => { expect(cloudDisplayState({ ...link, localOnly: true }, 3, true)).toBe('local'); expect(cloudDisplayState({ ...link, state: 'conflict' }, 3, true)).toBe('conflict'); });
});
