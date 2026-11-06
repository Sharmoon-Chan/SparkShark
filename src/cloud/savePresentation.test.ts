import { describe, expect, it } from 'vitest';
import { cloudDisplayState, type CloudLink } from './links';
import { cloudSavePresentation, localSavePresentation } from './savePresentation';

describe('save feedback describes actual local and cloud states', () => {
  it('offers sync when a previously synced document has new local edits', () => {
    const link: CloudLink = { localId: 'a', cloudId: 'b', userId: 'c', cloudRevision: 1, syncedLocalRevision: 2, state: 'synced', error: null };
    expect(cloudSavePresentation(cloudDisplayState(link, 2, true), false)).toMatchObject({ label: '云端待同步', action: '立即同步' });
    expect(cloudSavePresentation(cloudDisplayState(link, 3, false), true).action).toBe('立即同步');
    expect(cloudSavePresentation(cloudDisplayState(link, 2, false), true).action).toBe('云端管理');
  });
  it('does not claim a local save succeeded when sync fails during an unsaved edit', () => {
    expect(cloudSavePresentation('local', false).description).not.toContain('只保存在本机');
    expect(cloudSavePresentation('local', true).description).toContain('只保存在本机');
    expect(cloudSavePresentation('error', false).description).not.toContain('本机已保存');
    expect(cloudSavePresentation('error', true).description).toContain('本机已保存');
    expect(cloudSavePresentation('conflict', false)).toMatchObject({ problem: true, action: '处理冲突' });
  });
  it('keeps local failure and version conflict distinct and recoverable', () => {
    expect(localSavePresentation('failed')).toMatchObject({ label: '本机保存失败', problem: true });
    expect(localSavePresentation('failed').description).toContain('下载当前草稿');
    expect(localSavePresentation('conflict').description).toContain('另一个标签页');
    expect(localSavePresentation('saved').description).toContain('云端同步状态单独显示');
  });
});
