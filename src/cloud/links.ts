import Dexie, { type Table } from 'dexie';
export interface CloudLink {
  localId: string; userId: string | null; cloudId: string | null; cloudRevision: number; syncedLocalRevision: number;
  state: 'pending' | 'syncing' | 'synced' | 'error' | 'conflict'; error: string | null;
  localOnly?: boolean;
}
export class CloudLinkDatabase extends Dexie {
  cloudLinks!: Table<CloudLink, string>;
  constructor(name = 'myresume-cloud-links-v1') { super(name); this.version(1).stores({ cloudLinks: 'localId,userId,[userId+cloudId]' }); }
}
export const linkDatabase = new CloudLinkDatabase();
export function isVisibleToAccount(link: CloudLink | undefined, userId: string | null) { return !link || link.userId === null || link.userId === userId; }
export function cloudDisplayState(link: CloudLink | undefined, localRevision: number | undefined, dirty = false): CloudLink['state'] | 'local' {
  if (!link || link.localOnly) return 'local';
  if (link.state === 'synced' && (dirty || (localRevision !== undefined && localRevision !== link.syncedLocalRevision))) return 'pending';
  return link.state;
}
