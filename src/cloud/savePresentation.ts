import type { cloudDisplayState } from './links';

export type LocalSaveState = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict';
export function localSavePresentation(state: LocalSaveState) {
  const labels: Record<LocalSaveState, string> = { saved: '本机已保存', pending: '等待保存', saving: '本机保存中', failed: '本机保存失败', conflict: '本机版本冲突' };
  const descriptions: Record<LocalSaveState, string> = {
    saved: '当前修改已保存在这个浏览器中。云端同步状态单独显示。',
    pending: '正在等待自动保存。你也可以立即保存。',
    saving: '正在把当前修改写入这个浏览器。',
    failed: '当前修改尚未保存到本机，编辑内容仍保留。请重试，或下载当前草稿。',
    conflict: '另一个标签页已更新这份简历。请处理版本冲突，当前修改仍保留。',
  };
  return { label: labels[state], description: descriptions[state], problem: state === 'failed' || state === 'conflict' };
}

export function cloudSavePresentation(state: ReturnType<typeof cloudDisplayState>, localSaved: boolean) {
  const local = localSaved ? '本机已保存。' : '编辑内容仍保留在当前页面；请同时留意本机保存状态。';
  switch (state) {
    case 'local': return { label: '仅本机', action: '保存到云端', description: localSaved ? '当前简历只保存在本机浏览器。' : '当前简历未开启云端同步，请留意本机保存状态。', problem: false };
    case 'pending': return { label: '云端待同步', action: '立即同步', description: `${local}最新修改尚未同步到云端。`, problem: false };
    case 'syncing': return { label: '云端同步中', action: '', description: `${local}正在同步最新修改。`, problem: false };
    case 'synced': return { label: '云端已同步', action: '云端管理', description: '云端已同步到当前本机版本。', problem: false };
    case 'conflict': return { label: '云端版本冲突', action: '处理冲突', description: `${local}云端存在另一版本，请选择保留哪一份修改。`, problem: true };
    case 'error': return { label: '云端同步失败', action: '重试同步', description: `${local}云端尚未收到最新修改，请重试。`, problem: true };
  }
}
