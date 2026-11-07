// Isolated production-preview session, synthetic resume only.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = new URL(page.url()).origin, requests = [];
  const observe = request => requests.push(new URL(request.url()).pathname);
  page.on('request', observe);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let blocked = false;
  const delayed = async route => { blocked = true; await gate; await route.continue(); };
  await page.route('**/assets/ImportDialog-*.js', delayed);
  try {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(origin + '/');
    await page.getByRole('heading', { name: '我的简历', exact: true }).waitFor();
    assert(!requests.some(path => /ImportDialog-|parsers-|HistoryDialog-/.test(path)), 'Closed dialog loaded its implementation');
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入简历', exact: true });
    await dialog.getByText('正在打开，请稍候。', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    release();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => /ImportDialog-.*\.js/.test(entry.name)));
    assert(blocked && await dialog.count() === 0, 'Loading completion reopened cancelled dialog');
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    await dialog.getByRole('button', { name: 'JSON 备份', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
    await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    assert(!requests.some(path => /HistoryDialog-/.test(path)), 'History loaded before request');
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    const history = page.getByRole('dialog', { name: '历史记录', exact: true });
    await history.getByRole('button', { name: '查看差异', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await history.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '导出与备份', exact: true }).click();
    await page.locator('.panel-content').getByRole('button', { name: '导入简历', exact: true }).click();
    await dialog.getByRole('button', { name: 'JSON 备份', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { unopenedDialogsDeferred: true, cancelledLoadStaysClosed: true, homeAndExportImportEntry: true, historyOnDemand: true, unexpectedPdfRequests: requests.filter(path => /pdfRuntime-|pdfImport-|PdfPreview-/.test(path)).length };
  } finally { release(); await page.unroute('**/assets/ImportDialog-*.js', delayed); page.off('request', observe); }
}
