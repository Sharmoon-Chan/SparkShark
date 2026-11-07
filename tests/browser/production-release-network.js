// Actual released-site transport, no artificial network throttle or routing.
// Use an isolated anonymous profile after uploads and other download checks finish.
async (page) => {
  const url = page.url();
  if (!new URL(url).pathname.startsWith('/resume/')) throw new Error('Open a synthetic resume first');
  const cdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width: 1440, height: 980 }); await page.bringToFront();
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.__productionTiming = { gaps: [] };
    let previous = performance.now();
    const sample = () => {
      const now = performance.now(), out = window.__productionTiming;
      if (now - previous > 100) out.gaps.push(Math.round(now - previous)); previous = now;
      if (!out.editorMs && document.querySelector('#basics-name')) out.editorMs = now;
      const preview = document.querySelector('.html-preview-frame')?.contentDocument?.querySelector('#preview-pages');
      if (preview?.dataset.ready === 'true' && !out.previewMs) out.previewMs = now;
      if (out.previewMs && preview.dataset.fontState === 'ready' && !out.fontReadyMs) {
        out.fontReadyMs = now;
        requestAnimationFrame(() => requestAnimationFrame(() => { out.stableMs = performance.now(); out.pages = Number(preview.dataset.pageCount); }));
      }
      if (out.previewMs && preview.dataset.fontState === 'fallback') { out.fontError = preview.dataset.fontError || preview.dataset.fontMissing; out.finished = true; }
      if (!out.stableMs && !out.finished) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const rows = [];
  try {
    for (let run = 0; run < 3; run++) for (const cache of ['cold', 'warm']) {
      if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
      await page.bringToFront();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => window.__productionTiming?.stableMs || window.__productionTiming?.finished, null, { timeout: 120000 });
      rows.push(await page.evaluate(({ run, cache }) => ({ run, cache, ...window.__productionTiming, visibility: document.visibilityState, resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, durationMs: entry.duration, startMs: entry.startTime })) }), { run, cache }));
    }
  } finally { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await cdp.detach(); }
  const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { count: values.length, medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, minMs: sorted[0] ?? null, maxMs: sorted.at(-1) ?? null }; };
  const summary = ['cold', 'warm'].map(cache => ({ cache, preview: stats(rows.filter(row => row.cache === cache).map(row => row.previewMs)), fontStable: stats(rows.filter(row => row.cache === cache && row.stableMs).map(row => row.stableMs)), fontFailures: rows.filter(row => row.cache === cache && row.fontError).length }));
  const result = { origin: new URL(url).origin, completedAt: new Date().toISOString(), browser: page.context().browser().version(), conditions: 'Real public network, foreground emulation, default synthetic two-page resume, three cold/warm pairs, no simultaneous release upload or verification downloads. No artificial network/CPU throttle.', rows, summary };
  const event = page.waitForEvent('download');
  await page.evaluate(data => { const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = href; a.download = 'production-network.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, result);
  await (await event).saveAs('output/release-2026-11-07/network.json');
  return { summary, completedAt: result.completedAt };
}
