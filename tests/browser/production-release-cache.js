// Check the released response cache policy in a fresh anonymous browser session.
async (page) => {
  if (!page.url().startsWith('https://sparkshark.sharmoon.cc.cd/')) throw new Error('Open the released site first');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    await page.setViewportSize({ width: 1440, height: 980 }); await page.bringToFront();
    if (!new URL(page.url()).pathname.startsWith('/resume/')) await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
    const url = page.url(), rows = [];
    for (const cache of ['cold', 'warm']) {
      if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
      await page.goto(url, { timeout: 120000 });
      await page.waitForFunction(() => document.querySelector('.html-preview-frame')?.contentDocument?.querySelector('#preview-pages')?.dataset.fontState === 'ready', null, { timeout: 120000 });
      rows.push(await page.evaluate(cache => ({ cache, resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize })) }), cache));
    }
    const cached = rows[1].resources.filter(entry => entry.path.startsWith('/assets/') || entry.path.startsWith('/fonts/browser/'));
    if (cached.length < 8 || cached.some(entry => entry.transferBytes !== 0)) throw new Error('Versioned files did not use browser cache');
    const result = { origin: new URL(url).origin, completedAt: new Date().toISOString(), cachedResources: cached.length, rows };
    const event = page.waitForEvent('download');
    await page.evaluate(data => { const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = href; a.download = 'production-cache.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, result);
    await (await event).saveAs('output/release-2026-11-07/cache.json');
    return { cachedResources: result.cachedResources, productionCacheVerified: true };
  } finally { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await cdp.detach(); }
}
