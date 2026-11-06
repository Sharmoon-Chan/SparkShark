// Vite development-server harness; all fixtures are synthetic and local.
async (page) => {
  await page.bringToFront();
  await page.reload();
  const photoResponse = await page.request.get(new URL('/docs/fixtures/demo-avatar.png', page.url()).href);
  const photoData = 'data:image/png;base64,' + (await photoResponse.body()).toString('base64');
  const result = await page.evaluate(async photoData => {
    const { paginationFixtures } = await import('/tests/fixtures/pagination.ts');
    const { renderHtmlPreview, HTML_PREVIEW_SHELL } = await import('/src/features/preview/htmlPreviewDocument.ts');
    const { createHtmlPreviewRuntime } = await import('/src/features/preview/htmlPreviewRuntime.ts');
    const { FONT_OPTIONS } = await import('/src/domain/fonts.ts');
    const { createExample } = await import('/src/domain/resume.ts');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:1123px;z-index:100000;background:white';
    frame.setAttribute('sandbox', 'allow-same-origin');
    const loaded = new Promise(resolve => { frame.onload = resolve; }); frame.srcdoc = HTML_PREVIEW_SHELL; document.body.append(frame); await loaded;
    const doc = frame.contentDocument;
    let latest, font;
    const runtime = createHtmlPreviewRuntime(doc, { onLayout: state => { latest = state; }, onFontStatus: state => { font = state; }, onSelect: () => {} });
    const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
    const wait = async condition => { const until = performance.now() + 45000; while (!condition()) { if (performance.now() > until) throw new Error('Timed out waiting for layout/font'); await tick(); } };
    const set = async (resume, photo) => {
      const previous = latest?.revision ?? 0;
      runtime.update(renderHtmlPreview(resume, photo), resume);
      await wait(() => latest && (latest.revision > previous || latest.error));
      if (latest.error) throw new Error(latest.error);
      return latest;
    };
    const fixtures = paginationFixtures();
    const reports = [], fonts = [], measurements = [];
    try {
      for (const { id, resume, photo } of fixtures) {
        const firstStart = performance.now();
        const first = await set(resume, photo ? photoData : undefined); const fallbackMs = performance.now() - firstStart;
        await wait(() => font?.state !== 'loading');
        await tick(); await tick();
        if (latest.error) throw new Error(id + ': ' + latest.error);
        const diag = latest.diagnostics;
        let visibleGlyphCuts = 0; const cutDetails=[];
        for (const clip of runtime.destination.querySelectorAll('.preview-column-clip')) {
          const bounds = clip.getBoundingClientRect(), walker = doc.createTreeWalker(clip, 4), range = doc.createRange();
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            range.selectNodeContents(walker.currentNode);
            for (const rect of range.getClientRects()) {
              if (!rect.width || rect.bottom <= bounds.top + .2 || rect.top >= bounds.bottom - .2) continue;
              if (rect.top < bounds.top - .3 || rect.bottom > bounds.bottom + .3) { visibleGlyphCuts++; cutDetails.push({text:walker.currentNode.textContent, rect:{top:rect.top,bottom:rect.bottom},bounds:{top:bounds.top,bottom:bounds.bottom},clip:clip.dataset,html:walker.currentNode.parentElement.outerHTML.slice(0,500)}); }
            }
          }
        }
        if (visibleGlyphCuts) throw new Error(id + ': actual output cuts ' + visibleGlyphCuts + ' glyph runs: ' + JSON.stringify(cutDetails));
        const reading = doc.getElementById('preview-reading').cloneNode(true); reading.querySelectorAll('button').forEach(item => item.remove());
        if (reading.textContent !== runtime.source.textContent) throw new Error(id + ': accessible reading copy differs');
        if (doc.querySelectorAll('#preview-pages [tabindex="0"]').length) throw new Error('Visual duplicate tab stops');
        reports.push({ id, fallbackMs, fallbackPages: first.pages, selectedFontPages: latest.pages, font: { state: font.state, bytes: font.bytes, missing: font.missingCharacters, error: font.error }, sourceLines: diag.sourceLines, renderedLines: diag.renderedLines, lineCuts: diag.lineCuts, visibleGlyphCuts, nodes: runtime.destination.querySelectorAll('*').length });
      }
      for (const option of FONT_OPTIONS) {
        const resume = createExample(); resume.appearance.fontFamilyId = option.id;
        await set(resume); await wait(() => font?.state !== 'loading'); await tick(); await tick();
        fonts.push({ id: `font-${option.id}`, pages: latest.pages, bytes: font.bytes, state: font.state, missing: font.missingCharacters, error: font.error });
      }
      for (const id of ['two-logical-groups', 'double-left-long-sidebar']) {
        const resume = structuredClone(fixtures.find(item => item.id === id).resume);
        await set(resume); await wait(() => font?.state !== 'loading'); await tick(); await tick();
        const times = [], layoutTimes = [];
        for (let i = 0; i < 20; i++) {
          resume.basics.name = `编辑测量 ${String(i).padStart(2, '0')}`;
          const started = performance.now();
          const state = await set(resume); await tick();
          times.push(performance.now() - started); layoutTimes.push(state.durationMs);
          if (frame.contentDocument !== doc) throw new Error('Iframe document was rebuilt');
        }
        times.sort((a, b) => a - b); layoutTimes.sort((a, b) => a - b);
        const revision = latest.revision;
        runtime.update(renderHtmlPreview(resume), { ...resume, revision: resume.revision + 1, updatedAt: new Date().toISOString() });
        await tick(); await tick(); await tick();
        if (latest.revision !== revision) throw new Error('Save metadata triggered repagination');
        measurements.push({ id, pages: latest.pages, repetitions: times.length, medianMs: (times[9] + times[10]) / 2, p95Ms: times[18], layoutMedianMs: (layoutTimes[9] + layoutTimes[10]) / 2, layoutP95Ms: layoutTimes[18], sortedSamplesMs: times, sortedLayoutSamplesMs: layoutTimes, documentStable: true, saveMetadataDeduplicated: true });
      }
    } finally { runtime.dispose(); frame.remove(); }
    return { reports, fonts, measurements, userAgent: navigator.userAgent, sampledAt: new Date().toISOString() };
  }, photoData);
  await page.evaluate(value => { window.__paginationStage2Report = value; }, result);
  console.log(JSON.stringify(result));
  return result;
}
