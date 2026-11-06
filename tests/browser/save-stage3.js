// Use an isolated Vite development session; simulated cloud states never leave it.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const cloudWrites = [];
  await page.context().route('**/api/**', async route => {
    if (route.request().method() !== 'GET') cloudWrites.push(route.request().url());
    await route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 980 });
  const name = page.getByRole('textbox', { name: '全名', exact: true });
  await name.waitFor();
  const originalName = await name.inputValue();
  await page.evaluate(() => {
    window.__stage3Put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'resumes') throw new DOMException('Synthetic quota limit', 'QuotaExceededError'); return window.__stage3Put.apply(this, args); };
  });
  try {
    await name.fill('保存失败草稿样例');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.save-indicator.failed').waitFor();
    const warning = page.locator('.save-warning');
    assert(await warning.isVisible(), 'Save failure has no persistent notice');
    const pending = page.waitForEvent('download');
    await warning.getByRole('button', { name: '下载当前草稿', exact: true }).click();
    const downloaded = await pending;
    await downloaded.saveAs('output/playwright/stage3-unsaved.json');
    const stream = await downloaded.createReadStream(); let content = '';
    for await (const chunk of stream) content += chunk.toString();
    assert(JSON.parse(content).resumes[0].basics.name === '保存失败草稿样例', 'Backup omitted unsaved content');
    await page.setViewportSize({ width: 375, height: 812 });
    const status = page.getByRole('button', { name: '保存状态：本机保存失败', exact: true });
    await status.click();
    const detail = page.getByRole('dialog', { name: '本机保存状态', exact: true }); await detail.waitFor();
    assert(await detail.getByRole('button', { name: '下载当前草稿', exact: true }).isVisible(), 'Mobile recovery unavailable');
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.classList.contains('save-status-trigger'));
    assert(await status.evaluate(element => element === document.activeElement), 'Save detail focus not restored');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Failure notice mobile overflow');
    await page.screenshot({ path: 'output/playwright/stage3-save-failure-mobile.png', scale: 'css' });
  } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = window.__stage3Put; delete window.__stage3Put; }); }
  await page.locator('.save-warning').getByRole('button', { name: '重试保存', exact: true }).click();
  await page.locator('.save-indicator.saved').waitFor();
  await name.fill(originalName); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.save-indicator.saved').waitFor();
  const inject = async (state, syncedOffset = 0) => page.evaluate(async ({ state, syncedOffset }) => {
    const { useCloud } = await import('/src/cloud/account.ts'); const { useApp } = await import('/src/app/store.ts');
    const resume = useApp.getState().current;
    window.__stage3Links ??= useCloud.getState().links;
    useCloud.setState({ links: { ...window.__stage3Links, [resume.id]: { localId: resume.id, userId: null, cloudId: 'synthetic-cloud', cloudRevision: 1, syncedLocalRevision: resume.revision + syncedOffset, state, error: state === 'error' ? 'Synthetic upload failure' : null } } });
  }, { state, syncedOffset });
  try {
    await page.setViewportSize({ width: 1440, height: 980 });
    await inject('synced', -1);
    await page.locator('.cloud-status.pending').waitFor();
    assert(await page.locator('.editor-topbar').getByRole('button', { name: '立即同步', exact: true }).isVisible(), 'Pending offers manage instead of sync');
    await inject('error');
    const notice = page.locator('.cloud-save-notice'); await notice.waitFor();
    assert((await notice.textContent()).includes('本机已保存'), 'Cloud failure incorrectly loses local saved fact');
    await notice.getByRole('button', { name: '重试同步', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '同步当前修改到云端？', exact: true }); await confirm.waitFor();
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await inject('conflict');
    await notice.getByRole('link', { name: '处理冲突', exact: true }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert(await notice.getByRole('link', { name: '处理冲突', exact: true }).isVisible(), 'Mobile cloud conflict action hidden');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Cloud conflict mobile overflow');
    await page.screenshot({ path: 'output/playwright/stage3-cloud-conflict-mobile.png', scale: 'css' });
  } finally { await page.evaluate(async () => { const { useCloud } = await import('/src/cloud/account.ts'); useCloud.setState({ links: window.__stage3Links }); delete window.__stage3Links; }); await page.context().unroute('**/api/**'); }
  assert(cloudWrites.length === 0, 'Unexpected remote account/resume write');
  await page.setViewportSize({ width: 1440, height: 980 });
  return { failedSaveRetainsDraft: true, draftBackupVerified: true, retryRecovers: true, mobileStatusAndFocus: true, cloudPendingAction: true, cloudFailureAndConflictActions: true, cloudWrites: 0 };
}
