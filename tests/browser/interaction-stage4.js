// Production UI/store-to-paint timing, 20 edits and switches for a synthetic resume.
async (page) => {
  await page.setViewportSize({ width: 1440, height: 980 }); await page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const originalUrl = page.url();
  const results = [];
  const waitStable = () => page.waitForFunction(() => document.querySelector('.html-preview-frame')?.contentDocument?.querySelector('#preview-pages')?.dataset.fontState === 'ready');
  try {
    for (const sample of ['two-pages', 'long-sidebar']) {
      if (sample === 'long-sidebar') {
        await page.goto(new URL('/', originalUrl).href);
        await page.getByRole('button', { name: '导入简历', exact: true }).click();
        await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/stage4/long-resume-backup.json');
        await page.getByRole('dialog', { name: '导入简历', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click();
      }
      await page.getByRole('button', { name: '简历内容', exact: true }).click(); await waitStable();
      const editing = await page.evaluate(async () => {
        const source = document.querySelector('.html-preview-frame').contentDocument;
        const original = document.querySelector('#basics-name').value;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const waitFor = async predicate => { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 5000) throw new Error('Preview update timed out'); await tick(); } };
        const times = [], layouts = [];
        for (let i = 0; i < 20; i++) {
          const preview = source.querySelector('#preview-pages'), revision = preview.dataset.paginationRevision;
          const text = original + ' ' + (i % 2 ? '0' : '1'), start = performance.now();
          const input = document.querySelector('#basics-name'); setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => source.querySelector('#preview-pages h1')?.textContent === text && preview.dataset.paginationRevision !== revision);
          await tick();
          times.push(performance.now() - start); layouts.push(Number(preview.dataset.layoutDuration));
        }
        const input = document.querySelector('#basics-name'); setter.call(input, original); input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => source.querySelector('#preview-pages h1')?.textContent === original);
        return { times, layouts, pages: Number(source.querySelector('#preview-pages').dataset.pageCount), stableDocument: source === document.querySelector('.html-preview-frame').contentDocument };
      });
      await page.getByRole('button', { name: '风格模板', exact: true }).click();
      const switching = await page.evaluate(async sample => {
        const frame = document.querySelector('.html-preview-frame').contentDocument;
        const names = sample === 'long-sidebar' ? ['应用并列模板', '应用色带模板'] : ['应用清简模板', '应用条理模板'];
        const buttons = names.map(name => Array.from(document.querySelectorAll('.template-card')).find(button => button.getAttribute('aria-label') === name));
        if (buttons.some(button => !button)) throw new Error('Template choices missing');
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const times = [], pageCounts = [];
        buttons[1].click();
        for (let i = 0; i < 3; i++) await tick();
        for (let i = 0; i < 20; i++) {
          const preview = frame.querySelector('#preview-pages'), revision = preview.dataset.paginationRevision;
          const button = buttons[i % 2], start = performance.now(); button.click();
          while (preview.dataset.paginationRevision === revision) { if (performance.now() - start > 5000) throw new Error('Template update timed out'); await tick(); }
          await tick(); times.push(performance.now() - start); pageCounts.push(Number(preview.dataset.pageCount));
        }
        return { times, pageCounts, templates: names, stableDocument: frame === document.querySelector('.html-preview-frame').contentDocument };
      }, sample);
      const stats = times => { const sorted = [...times].sort((a, b) => a - b); return { medianMs: (sorted[9] + sorted[10]) / 2, p95Ms: sorted[18], samples: times.length }; };
      results.push({ sample, editing, switching, summary: { edit: stats(editing.times), switch: stats(switching.times) } });
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.locator('.save-indicator.saved').waitFor();
    }
  } finally { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await cdp.detach(); await page.goto(originalUrl); }
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(data => { const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = href; a.download = 'interaction-stage4.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); }, { date: '2026-11-07', results, measurement: 'Native input setter + DOM input/click events through React store to updated paginated DOM and next animation frame. Not human typing or stage-2 runtime-only measurement.' });
  await (await downloadEvent).saveAs('output/stage4/interaction-report.json');
  return results.map(result => ({ sample: result.sample, pagesBeforeSwitching: result.editing.pages, ...result.summary, stableDocument: result.editing.stableDocument && result.switching.stableDocument }));
}
