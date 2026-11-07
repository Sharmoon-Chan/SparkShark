// Run against the released site in an isolated anonymous browser profile.
// All fixtures and created resumes are synthetic and remain in this browser.
async (page) => {
  const origin = new URL(page.url()).origin;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const writes = [], timings = [];
  const observe = request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url()); };
  page.on('request', observe);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(origin + '/');
  const open = async () => {
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    await page.getByRole('button', { name: 'JSON 备份', exact: true }).waitFor({ timeout: 120000 });
    return page.getByRole('dialog', { name: '导入简历', exact: true });
  };
  try {
    let dialog = await open();
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/stage4/long-resume-backup.json');
    await dialog.getByRole('heading', { name: '将创建 1 份简历', exact: true }).waitFor();
    assert(await dialog.getByRole('button', { name: '确认导入', exact: true }).isEnabled(), 'JSON backup did not parse');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    dialog = await open();
    await dialog.getByRole('button', { name: '文本 / Markdown', exact: true }).click();
    await dialog.getByRole('textbox', { name: '粘贴文本', exact: true }).fill('# 个人总结\n\n发布验收虚构内容。\n\n# 校园活动\n\n自定义模块内容需完整保留。');
    await dialog.getByRole('button', { name: '预览解析结果', exact: true }).click();
    assert(await dialog.getByRole('combobox', { name: '校园活动映射到模块', exact: true }).inputValue() === 'custom', 'Markdown custom mapping failed');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    for (let run = 0; run < 3; run++) {
      dialog = await open();
      const started = Date.now();
      await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/stage4/ui-example.pdf');
      await dialog.getByRole('heading', { name: '核对识别结果', exact: true }).waitFor({ timeout: 120000 });
      assert((await dialog.getByRole('textbox', { name: '全名', exact: true }).inputValue()).includes('林'), 'PDF name missing');
      timings.push({ type: 'pdf', run, elapsedMs: Date.now() - started, condition: run ? 'parser cache warm' : 'first parser request in session' });
      if (run === 2) {
        await page.setViewportSize({ width: 375, height: 812 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow PDF review overflows');
        await page.screenshot({ path: 'output/release-2026-11-07/pdf-import-mobile.png', scale: 'css', animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 980 });
        await dialog.getByRole('textbox', { name: '全名', exact: true }).fill('发布验收 PDF 示例');
        await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
        await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
        await page.locator('.save-indicator.saved').waitFor();
        await page.reload();
        await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
        assert(await page.getByRole('textbox', { name: '全名', exact: true }).inputValue() === '发布验收 PDF 示例', 'Imported data did not survive reload');
        await page.goto(origin + '/');
      } else await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    dialog = await open();
    const started = Date.now();
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/docx/resume-example.docx');
    await dialog.getByRole('heading', { name: '核对识别结果', exact: true }).waitFor({ timeout: 120000 });
    assert(await dialog.getByRole('textbox', { name: '全名', exact: true }).inputValue() === '林文档示例', 'DOCX name missing');
    timings.push({ type: 'docx', run: 0, elapsedMs: Date.now() - started, condition: 'first DOCX parser request in session' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert(writes.length === 0, 'Unexpected remote account/resume write');
    const result = { origin, completedAt: new Date().toISOString(), jsonBackup: true, markdownCustomMapping: true, pdfImportAndReload: true, docxReview: true, mobileOverflow: false, timings, cloudWrites: writes.length };
    const downloaded = page.waitForEvent('download');
    await page.evaluate(data => { const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = href; a.download = 'production-imports.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, result);
    await (await downloaded).saveAs('output/release-2026-11-07/imports.json');
    return result;
  } finally { page.off('request', observe); }
}
