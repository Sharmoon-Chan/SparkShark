async (page) => {
  const origin = new URL(page.url()).origin;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(origin + '/');
  await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
  const ready = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); return page.waitForFunction(() => document.querySelector('.pdf-pages:not(.updating) canvas[data-rendered="true"]') || document.querySelector('.preview-error'), null, { timeout: 30000 }); };
  await ready();
  await page.getByRole('button', { name: '页面设置', exact: true }).click();
  const font = page.getByRole('combobox', { name: '简历字体', exact: true });
  await font.selectOption('noto-sans-sc'); await ready();
  const delayed = [];
  await page.context().route(origin + '/fonts/compressed/wenkai-*.ttf', async route => {
    const delay = new Promise(resolve => setTimeout(resolve, 5000)); delayed.push(delay);
    await delay;
    await route.continue().catch(() => undefined);
  });
  const requested = page.context().waitForEvent('request', request => request.url().includes('/fonts/compressed/wenkai-'));
  await font.selectOption('lxgw-wenkai'); await requested;
  const start = Date.now();
  await font.selectOption('noto-sans-sc'); await ready();
  const cancelledColdFontMs = Date.now() - start;
  assert(cancelledColdFontMs < 4000, 'Cancelled font download held up current preview: ' + cancelledColdFontMs + 'ms');
  assert(await page.locator('.preview-error').count() === 0, 'Preview failed after cancelling font');
  await Promise.all(delayed); await page.context().unroute(origin + '/fonts/compressed/wenkai-*.ttf');
  await font.selectOption('lxgw-wenkai'); await ready();
  assert(await page.locator('.preview-error').count() === 0, 'Cancelled font could not be loaded again');
  await page.getByRole('button', { name: '风格模板', exact: true }).click();
  assert(await page.locator('.template-card').count() === 16, 'Template catalog changed');
  await page.waitForFunction(() => document.querySelector('.template-card.selected img'));
  const initialThumbnails = await page.locator('.template-card img').count();
  assert(initialThumbnails < 16, 'All offscreen templates were rendered eagerly');
  const names = await page.locator('.template-card').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
  for (const name of names) {
    if (await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true') continue;
    await page.getByRole('button', { name, exact: true }).click(); await ready();
    assert(await page.locator('.preview-error').count() === 0, 'Preview failed for ' + name);
  }
  await page.getByRole('button', { name: /^单栏/ }).click();
  assert(await page.locator('.template-card').count() === 8, 'Single-column filter failed');
  await page.getByRole('button', { name: /^双栏/ }).click();
  assert(await page.locator('.template-card').count() === 8, 'Double-column filter failed');
  await page.getByRole('button', { name: '应用晨光模板', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.template-card.selected img'));
  const thumbnailCount = await page.locator('.template-card img').count();
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile viewport overflows');
  await page.screenshot({ path: 'output/playwright/preview-performance-mobile.png', scale: 'css' });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.screenshot({ path: 'output/playwright/preview-performance-templates.png', scale: 'css' });
  return { cancelledColdFontMs, retriedColdFont: true, checkedTemplates: names.length, filters: [8, 8], initialThumbnails, thumbnailCount, mobileOverflow: false };
}
