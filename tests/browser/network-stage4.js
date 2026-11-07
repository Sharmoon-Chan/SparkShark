// Run on a synthetic resume in an isolated foreground production-preview session.
// Uses real browser cache (no request routing). Vite preview is not a Cloudflare benchmark.
async (page) => {
  const url = page.url();
  if (!new URL(url).pathname.startsWith('/resume/')) throw new Error('Open a synthetic resume first');
  await page.setViewportSize({ width: 1440, height: 980 }); await page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const network = { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular4g' };
  const noThrottle = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  await page.addInitScript(() => {
    if (window.__stage4Timing) return;
    window.__stage4Timing = { frameGaps: [], visibility: document.visibilityState };
    let last = performance.now();
    function sample() {
      const out = window.__stage4Timing, now = performance.now();
      if (now - last > 100) out.frameGaps.push(Math.round(now - last));
      last = now;
      if (!out.editorMs && document.querySelector('#basics-name')) out.editorMs = now;
      const preview = document.querySelector('.html-preview-frame')?.contentDocument?.querySelector('#preview-pages');
      if (preview?.dataset.ready === 'true' && !out.previewMs) out.previewMs = now;
      if (preview?.dataset.ready === 'true' && preview.dataset.fontState === 'ready' && !out.fontReadyMs) {
        out.fontReadyMs = now;
        requestAnimationFrame(() => requestAnimationFrame(() => { out.stableMs = performance.now(); out.pages = Number(preview.dataset.pageCount); }));
      }
      if (!out.stableMs) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const rows = [];
  try {
    for (const throttle of [false, true]) {
      await cdp.send('Network.emulateNetworkConditions', throttle ? network : noThrottle);
      for (let run = 0; run < 3; run++) {
        for (const cache of ['cold', 'warm']) {
          if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
          await page.bringToFront();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForFunction(() => window.__stage4Timing?.stableMs, null, { timeout: 120000 });
          rows.push(await page.evaluate(({ throttle, cache, run }) => {
            const resources = performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, startMs: entry.startTime, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize, durationMs: entry.duration }));
            return { throttle, cache, run, ...window.__stage4Timing, visibilityAtEnd: document.visibilityState, resources };
          }, { throttle, cache, run }));
        }
      }
    }
  } finally { await cdp.send('Network.emulateNetworkConditions', noThrottle); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await cdp.detach(); }
  const summarize = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { samples: values.length, median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2, min: sorted[0], max: sorted.at(-1) };
  };
  const summary = [];
  for (const throttle of [false, true]) for (const cache of ['cold', 'warm']) {
    const subset = rows.filter(row => row.throttle === throttle && row.cache === cache);
    summary.push({ throttle, cache, previewMs: summarize(subset.map(row => row.previewMs)), fontStableMs: summarize(subset.map(row => row.stableMs)), transferredBytes: summarize(subset.map(row => row.resources.reduce((sum, resource) => sum + resource.transferBytes, 0))) });
  }
  const output = { measuredAt: new Date().toISOString(), origin: new URL(url).origin, browser: page.context().browser().version(), network, rows, summary, caveats: ['Three observations per condition: median/min/max only, not p95.', 'Local static preview responses; inspect encoded/decoded sizes and cache hits before comparing with compressed CDN traffic.', 'No CPU throttle; font ready is recorded separately from initial fallback preview.'] };
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(data => { const a = document.createElement('a'); const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.href = href; a.download = 'network-stage4.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, output);
  await (await downloadEvent).saveAs('output/stage4/network-latest.json');
  return { summary, rows: rows.length, report: 'output/stage4/network-latest.json' };
}
