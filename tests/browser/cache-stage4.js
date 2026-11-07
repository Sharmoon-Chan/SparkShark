// Local Wrangler only: checks real response caching, no route interception.
async (page) => {
  const origin = 'http://127.0.0.1:4175';
  await page.setViewportSize({ width: 1440, height: 980 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  try {
    await page.goto(origin + '/');
    await page.getByRole('link', { name: '编辑 前端工程师 · 示例', exact: true }).click();
    const url = page.url(), results = [];
    for (const cache of ['cold', 'warm']) {
      if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('.html-preview-frame')?.contentDocument?.querySelector('#preview-pages')?.dataset.fontState === 'ready');
      results.push(await page.evaluate(cache => ({ cache, resources: performance.getEntriesByType('resource').map(resource => ({ path: new URL(resource.name).pathname, transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize })) }), cache));
    }
    const warm = results[1].resources;
    const stable = warm.filter(resource => resource.path.startsWith('/assets/') || resource.path.startsWith('/fonts/browser/'));
    if (!stable.length || stable.some(resource => resource.transferSize !== 0)) throw new Error('Hashed assets revalidated instead of using browser cache');
    const report = { environment: 'local Wrangler 4175, no CDN transit', date: '2026-11-07', results, immutableResourcesFromBrowserCache: stable.length };
    const event = page.waitForEvent('download');
    await page.evaluate(data => { const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = href; a.download = 'cache-stage4.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, report);
    await (await event).saveAs('output/stage4/cache-report.json');
    return { immutableResourcesFromBrowserCache: stable.length, unhashedCatalog: warm.filter(resource => resource.path.includes('browser-manifests')), api: warm.filter(resource => resource.path.startsWith('/api/')) };
  } finally { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await cdp.detach(); }
}
