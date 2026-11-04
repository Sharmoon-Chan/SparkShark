async (page) => {
  const passed = [], errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const waitPreview = () => page.waitForFunction(() => !document.querySelector('.preview-updating') && !document.querySelector('.preview-error') && document.querySelector('.preview canvas')?.dataset.rendered === 'true', null, { timeout: 30000 });
  const disabledImport = async () => { if (await page.getByRole('button', { name: '确认导入', exact: true }).isEnabled()) throw new Error('Invalid input enabled import'); };
  let importedUrl;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/docx/resume-example.docx');
    await page.getByRole('heading', { name: '核对识别结果', exact: true }).waitFor({ timeout: 30000 });
    const dialog = page.getByRole('dialog', { name: '导入简历', exact: true });
    if (await dialog.getByRole('textbox', { name: '全名', exact: true }).inputValue() !== '林文档示例') throw new Error('Word name mapping failed');
    if (await dialog.getByRole('textbox', { name: '电话', exact: true }).inputValue() !== '000-0000-0000') throw new Error('Word phone mapping failed');
    if (await dialog.getByRole('textbox', { name: '邮箱', exact: true }).inputValue() !== 'word.demo@example.com') throw new Error('Word email mapping failed');
    const summary = dialog.getByRole('textbox', { name: '个人总结识别内容', exact: true });
    for (const tag of ['strong', 'em', 'u', 's']) if (!await summary.locator(tag).count()) throw new Error('Word format missing: ' + tag);
    const photo = dialog.getByRole('switch', { name: '使用 Word 中的图片作为头像', exact: true });
    if (await photo.getAttribute('aria-checked') !== 'true') throw new Error('Word photo was not selected');
    const work = dialog.locator('.mapping-row').filter({ has: page.getByRole('combobox', { name: '工作经历映射到模块', exact: true }) });
    await work.getByRole('button', { name: '核对 2 条记录', exact: true }).click();
    const companies = work.getByRole('textbox', { name: '公司', exact: true });
    if (await companies.nth(0).inputValue() !== '示例科技公司' || await companies.nth(1).inputValue() !== '示例软件公司') throw new Error('Word jobs were merged or misplaced');
    if (!await work.getByRole('textbox', { name: '详情', exact: true }).first().locator('ul').count()) throw new Error('Word list structure was lost in review');
    await companies.first().fill('核对后的示例公司');
    await dialog.getByRole('textbox', { name: '全名', exact: true }).fill('Word 导入验收');
    await dialog.getByRole('textbox', { name: '简历标题', exact: true }).fill('Word 导入验收');
    await summary.click(); await summary.press('Control+End'); await summary.press('Enter'); await page.keyboard.insertText('导入前核对补充。');
    await dialog.locator('.modal-body').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: 'output/playwright/docx-import-review.png', scale: 'css' });
    passed.push('实际 DOCX 字段、两条经历、富文本核对和头像候选');

    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.locator('.modal-body').evaluate(element => { element.scrollTop = 0; });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Word import overflows mobile width');
    await page.screenshot({ path: 'output/playwright/docx-import-mobile.png', scale: 'css' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    importedUrl = page.url();
    if (await page.getByRole('textbox', { name: '全名', exact: true }).inputValue() !== 'Word 导入验收') throw new Error('Reviewed Word basics were not imported');
    await page.locator('.avatar-control img').waitFor(); await waitPreview();
    await page.reload(); await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    if (await page.getByRole('textbox', { name: '全名', exact: true }).inputValue() !== 'Word 导入验收') throw new Error('Word import did not survive reload');
    await page.locator('.avatar-control img').waitFor(); await waitPreview();
    await page.getByRole('button', { name: '布局设置', exact: true }).click();
    if (!(await page.getByRole('button', { name: '单栏', exact: true }).getAttribute('class'))?.includes('active')) throw new Error('Word without sidebar content did not choose a single column');
    await page.getByRole('button', { name: '简历内容', exact: true }).click();
    passed.push('核对后创建、头像事务、保存和刷新恢复，390 px 导入无横向溢出');

    await page.getByRole('button', { name: '导出与备份', exact: true }).click();
    const panel = page.locator('.panel-content');
    const backupEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 JSON 备份', exact: true }).click();
    await (await backupEvent).saveAs('output/playwright/docx-import-backup.json');
    const pdfEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 PDF', exact: true }).click();
    await (await pdfEvent).saveAs('output/playwright/docx-roundtrip.pdf');
    const htmlEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 HTML', exact: true }).click();
    const htmlDownload = await htmlEvent;
    if (!htmlDownload.suggestedFilename().endsWith('.html')) throw new Error('HTML download used the wrong extension');
    await htmlDownload.saveAs('output/playwright/resume-export.html');
    await page.screenshot({ path: 'output/playwright/local-formats-editor.png', scale: 'css' });
    passed.push('实际 JSON、PDF 和 HTML 文件下载');

    const htmlPage = await page.context().newPage();
    const requests = [];
    htmlPage.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    try {
      await page.context().setOffline(true);
      await htmlPage.setViewportSize({ width: 1440, height: 900 });
      await htmlPage.goto('file:///D:/Code/myresume/output/playwright/resume-export.html');
      await htmlPage.locator('.avatar').waitFor();
      if (!await htmlPage.locator('.avatar').evaluate(image => image.complete && image.naturalWidth > 0)) throw new Error('Offline HTML photo failed');
      const body = await htmlPage.locator('body').innerText();
      for (const phrase of ['Word 导入验收', '核对后的示例公司', '示例软件公司', '嵌套任务', '表格第二列的完整内容', '导入前核对补充']) if (!body.includes(phrase)) throw new Error('HTML lost content: ' + phrase);
      for (const tag of ['strong', 'em', 'u', 's', 'ul']) if (!await htmlPage.locator('.resume ' + tag).count()) throw new Error('HTML lost formatting: ' + tag);
      if (await htmlPage.locator('a').filter({ hasText: '作品链接' }).getAttribute('href') !== 'https://example.com/portfolio?a=1&b=2') throw new Error('HTML link changed');
      if (requests.length) throw new Error('Standalone HTML requested an external resource: ' + requests.join(', '));
      await htmlPage.screenshot({ path: 'output/playwright/html-export-desktop.png', fullPage: true, scale: 'css' });
      await htmlPage.setViewportSize({ width: 390, height: 844 });
      if (await htmlPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('HTML overflows mobile width');
      await htmlPage.screenshot({ path: 'output/playwright/html-export-mobile.png', fullPage: true, scale: 'css' });
      passed.push('下载的 HTML 离线打开、照片、完整内容、格式、链接和手机排版');
    } finally { await page.context().setOffline(false); await htmlPage.close(); }

    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    for (const [path, message] of [
      ['output/docx/resume-broken.docx', /损坏|无法读取/], ['output/docx/resume-empty.docx', /没有读取到可编辑文字/],
      ['output/docx/resume-legacy.doc', /另存为 DOCX/], ['output/docx/unsupported.bin', /请选择 PDF/],
    ]) {
      await page.getByLabel('选择导入文件', { exact: true }).setInputFiles(path);
      await page.getByRole('alert').filter({ hasText: message }).waitFor(); await disabledImport();
    }
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles({ name: 'oversize.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024 + 1, 'a') });
    await page.getByRole('alert').filter({ hasText: '文本文件需要小于 1 MB' }).waitFor(); await disabledImport();
    await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/docx/resume-header-footer.docx');
    await page.getByRole('heading', { name: '核对识别结果', exact: true }).waitFor();
    if (await page.getByRole('textbox', { name: '全名', exact: true }).inputValue() !== '页眉示例' || await page.getByRole('textbox', { name: '邮箱', exact: true }).inputValue() !== 'header.demo@example.com') throw new Error('Word header contact information was lost');
    await page.getByText('查看完整提取文字', { exact: true }).click();
    const headerSource = await page.getByRole('textbox', { name: 'Word 提取原文', exact: true }).inputValue();
    if (!headerSource.includes('页脚中的完整备注') || headerSource.includes('UNREFERENCED-HEADER-SECRET')) throw new Error('Word auxiliary part reading was incorrect');
    passed.push('页眉联系方式和页脚文字保留，未引用的旧文档部件不导入');
    await page.getByRole('button', { name: '文本 / Markdown', exact: true }).click();
    await page.getByRole('textbox', { name: '粘贴文本', exact: true }).fill('# 个人总结\n\n旧的预览内容。');
    await page.getByRole('button', { name: '预览解析结果', exact: true }).click();
    if (!await page.getByRole('button', { name: '确认导入', exact: true }).isEnabled()) throw new Error('Text preview failed');
    await page.getByRole('textbox', { name: '粘贴文本', exact: true }).fill('# 个人总结\n\n修改后的新内容。');
    await disabledImport();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    passed.push('损坏、空白、旧 DOC、未知格式和文本大小限制；修改文本后重新预览');
    await page.goto(importedUrl); await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    if (errors.length) throw new Error('Browser errors: ' + errors.join('\n'));
    return { passed, importedUrl, backup: 'output/playwright/docx-import-backup.json', pdf: 'output/playwright/docx-roundtrip.pdf', html: 'output/playwright/resume-export.html', browserErrors: errors };
  } finally { page.off('pageerror', onError); }
}
