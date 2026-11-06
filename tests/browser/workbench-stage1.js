async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  const blocked = [];
  const intercept = async route => {
    const url = route.request().url();
    if (/pdfRuntime|pdfImport|PdfPreview|pdfjs-dist|@react-pdf|\/fonts\/compressed\/|\/assets\/pdf[-.]/.test(url)) { blocked.push(url); await route.abort(); }
    else await route.continue();
  };
  const geometry = () => page.evaluate(() => ({
    paperTop: document.querySelector('.html-preview-stage')?.getBoundingClientRect().top,
    templateTop: document.querySelector('.template-grid').getBoundingClientRect().top,
    columns: getComputedStyle(document.querySelector('.template-grid')).gridTemplateColumns.split(' ').length,
    completenessHeight: document.querySelector('.completeness').getBoundingClientRect().height,
    viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
  }));
  await page.context().route('**/*', intercept);
  const report = { viewports: [] };
  try {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(origin + '/');
    await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
    const frame = page.frameLocator('.html-preview-frame');
    await frame.locator('#preview-pages[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: '风格模板', exact: true }).click();
    assert(await page.locator('.template-card').count() === 16, 'Template count changed');
    const first = await geometry();
    assert(first.columns === 3, 'Expected three columns at 1440px');
    assert(first.paperTop < 160 && first.templateTop < 240 && first.completenessHeight <= 50, 'Redundant headers still occupy the workbench');
    assert(await page.locator('.preview-pane .preview-heading').count() === 1, 'Expected one preview header');
    const help = page.getByRole('button', { name: '预览模式说明', exact: true });
    await help.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '预览模式', exact: true });
    await dialog.waitFor();
    assert((await dialog.textContent()).includes('字体和分页可能与导出不同'), 'Preview limitation missing from help');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert(await help.evaluate(element => element === document.activeElement), 'Help did not restore keyboard focus');
    const clean = page.getByRole('button', { name: '应用清简模板', exact: true });
    await clean.focus(); await page.keyboard.press('Enter');
    await frame.locator('#preview-pages.template-clean[data-ready="true"]').waitFor();
    assert(await clean.getAttribute('aria-pressed') === 'true', 'Keyboard selection failed');
    await page.getByRole('button', { name: /^单栏/ }).click();
    assert(await page.locator('.template-card').count() === 8, 'Single filter failed');
    await page.getByRole('button', { name: /^双栏/ }).click();
    assert(await page.locator('.template-card').count() === 8, 'Double filter failed');
    await page.getByRole('button', { name: /^全部/ }).click();
    await page.getByRole('button', { name: '应用并列模板', exact: true }).click();
    await frame.locator('#preview-pages.template-split[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: '检查简历', exact: true }).click();
    const checks = page.getByRole('dialog', { name: '检查简历', exact: true });
    await checks.waitFor(); await page.keyboard.press('Escape'); await checks.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.save-indicator.saved').waitFor();
    const toast = page.getByRole('button', { name: '关闭通知', exact: true });
    if (await toast.isVisible()) await toast.click();
    await page.locator('.panel-content').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: 'output/playwright/polish-stage1-after.png', scale: 'css' });
    report.desktop = await geometry();
    for (const width of [1920, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 980 });
      if (width <= 1100) await page.getByRole('button', { name: '编辑', exact: true }).click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measured = await geometry();
      assert(measured.pageWidth <= width, 'Horizontal overflow at ' + width);
      assert(measured.columns >= 2, 'Template cards collapsed at ' + width);
      if (width === 1920) assert(measured.columns === 5, 'Wide desktop should show five columns');
      if (width <= 1100) {
        await page.getByRole('button', { name: '预览', exact: true }).click();
        await frame.locator('#preview-pages[data-ready="true"]').waitFor();
        assert(await help.isVisible(), 'Preview controls unavailable on mobile');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Preview overflows at ' + width);
        await help.click(); await dialog.waitFor(); await page.keyboard.press('Escape');
        if (width === 375) await page.screenshot({ path: 'output/playwright/polish-stage1-mobile-preview.png', scale: 'css' });
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        if (width === 375) await page.screenshot({ path: 'output/playwright/polish-stage1-mobile-templates.png', scale: 'css' });
      }
      report.viewports.push(measured);
    }
    assert(blocked.length === 0, 'Workbench cleanup triggered PDF/font requests');
    report.pdfRequestsDuringInstantMode = blocked.length;
  } finally { await page.context().unroute('**/*', intercept); }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '精确 PDF', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-pages:not(.updating) canvas[data-rendered="true"]') || document.querySelector('.preview-error'), null, { timeout: 60000 });
  assert(await page.locator('.preview-error').count() === 0, 'Exact preview failed');
  await page.getByRole('button', { name: '拖动布局', exact: true }).click();
  assert(await page.getByRole('button', { name: '拖动布局', exact: true }).getAttribute('aria-pressed') === 'true', 'Field mode unavailable');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  assert(await page.getByRole('button', { name: '拖动布局', exact: true }).isVisible(), 'PDF field mode hidden on mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'PDF controls overflow');
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '即时预览', exact: true }).click();
  await page.frameLocator('.html-preview-frame').locator('#preview-pages[data-ready="true"]').waitFor();
  report.keyboardHelpAndTemplates = true; report.exactPdfAndDragMode = true;
  return report;
}
