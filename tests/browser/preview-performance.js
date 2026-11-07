async (page) => {
  const origin = new URL(page.url()).origin;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const heavyRequests = [];
  const isHeavy = url => /pdfRuntime|pdfImport|PdfPreview|pdfjs-dist|@react-pdf|\/fonts\/compressed\/|\/fonts\/(?:sans|serif|round|wenkai|plex|sourcehan)-.*\.ttf|\/workers\/pdf\.worker|\/assets\/pdf[-.]/.test(url);
  const blockHeavy = async route => {
    if (isHeavy(route.request().url())) { heavyRequests.push(route.request().url()); await route.abort(); }
    else await route.continue();
  };
  await page.context().route('**/*', blockHeavy);
  const observations = {};
  try {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(origin + '/');
    const openStart = Date.now();
    await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
    const frame = page.frameLocator('.html-preview-frame');
    await frame.locator('#preview-pages[data-ready="true"]').waitFor();
    observations.openEditorMs = Date.now() - openStart;
    assert(await page.getByRole('button', { name: '即时预览', exact: true }).getAttribute('aria-pressed') === 'true', 'Instant preview is not the default');
    const name = '即时预览验证 ' + Date.now();
    const editStart = Date.now();
    await page.getByRole('textbox', { name: '全名', exact: true }).fill(name);
    await frame.locator('#preview-reading').getByRole('heading', { name, exact: true }).waitFor({state:'attached'});
    observations.editMs = Date.now() - editStart;
    await page.getByRole('button', { name: '风格模板', exact: true }).click();
    const images = await page.locator('.template-card img').evaluateAll(items => items.map(item => item.getAttribute('src')));
    assert(images.length === 16 && images.every(Boolean), 'All sixteen static images must exist');
    const switchStart = Date.now();
    await page.getByRole('button', { name: '应用Essential · 青条模板', exact: true }).click();
    await frame.locator('#preview-pages.template-essential[data-ready="true"]').waitFor();
    observations.templateMs = Date.now() - switchStart;
    const names = await page.locator('.template-card').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
    for (const label of names) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await frame.locator('#preview-pages[data-ready="true"]').waitFor();
    }
    assert(JSON.stringify(images) === JSON.stringify(await page.locator('.template-card img').evaluateAll(items => items.map(item => item.getAttribute('src')))), 'Template images changed with live resume data');
    await page.getByRole('button', { name: '应用Essential · 青条模板', exact: true }).click();
    await frame.locator('#preview-pages.template-essential[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: '页面设置', exact: true }).click();
    await page.getByRole('combobox', { name: '简历字体', exact: true }).selectOption('source-han-sans-sc');
    const typography = await frame.locator('body').evaluate(body => {
      const style = element => ({ size: Number.parseFloat(getComputedStyle(element).fontSize), weight: getComputedStyle(element).fontWeight });
      return { body: style(body), section: style(body.querySelector('.resume-section h2')), entry: style(body.querySelector('.item-name')) };
    });
    assert(Math.abs(typography.section.size / typography.body.size - 20 / 14) < .01, 'Section title ratio is wrong');
    assert(Math.abs(typography.entry.size / typography.body.size - 18 / 14) < .01, 'Entry title ratio is wrong');
    assert(typography.body.weight === '400' && typography.entry.weight === '700', 'Body/bold contrast is wrong');
    observations.typography = typography;
    await frame.locator('#preview-pages .resume-section').first().click();
    assert(await page.getByRole('button', { name: '简历内容', exact: true }).count() === 1, 'Section navigation failed');
    await page.getByRole('textbox', { name: '全名', exact: true }).fill('林示例');
    await frame.locator('#preview-reading').getByRole('heading', { name: '林示例', exact: true }).waitFor({state:'attached'});
    await page.getByRole('button', { name: '风格模板', exact: true }).click();
    await page.screenshot({ path: 'output/playwright/instant-preview-desktop.png', scale: 'css' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await frame.locator('#preview-pages[data-ready="true"]').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow');
    await page.screenshot({ path: 'output/playwright/instant-preview-mobile.png', scale: 'css' });
    assert(heavyRequests.length === 0, 'Instant preview requested PDF/font assets: ' + heavyRequests.join(', '));
  } finally { await page.context().unroute('**/*', blockHeavy); }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '精确 PDF', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-pages:not(.updating) canvas[data-rendered="true"]') || document.querySelector('.preview-error'), null, { timeout: 60000 });
  assert(await page.locator('.preview-error').count() === 0, 'Exact PDF preview failed');
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  await (await downloadPending).saveAs('output/playwright/instant-preview-export.pdf');
  await page.getByRole('button', { name: '即时预览', exact: true }).click();
  await page.frameLocator('.html-preview-frame').locator('#preview-pages[data-ready="true"]').waitFor();
  return { ...observations, templateImages: 16, heavyRequestsInInstantMode: heavyRequests.length, mobileOverflow: false, exactPdfPreview: true, pdfExport: true };
}
