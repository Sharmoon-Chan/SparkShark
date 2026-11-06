// Run against the Vite development server in an isolated browser session.
async (page) => {
  return await page.evaluate(async () => {
    const { paginationFixtures } = await import('/tests/fixtures/pagination.ts');
    const { renderHtmlPreview, HTML_PREVIEW_SHELL } = await import('/src/features/preview/htmlPreviewDocument.ts');
    const { paginatePreview } = await import('/src/features/preview/domPagination.ts');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:1123px;z-index:100000;background:white';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    const loaded = new Promise(resolve => { iframe.onload = resolve; });
    iframe.srcdoc = HTML_PREVIEW_SHELL; document.body.append(iframe); await loaded;
    const doc = iframe.contentDocument;
    const source = doc.getElementById('preview-source'), destination = doc.getElementById('preview-pages'), style = doc.getElementById('preview-theme');
    const reports = [];
    const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    try {
      for (const fixture of paginationFixtures()) {
        const parsed = new DOMParser().parseFromString(renderHtmlPreview(fixture.resume, fixture.photo ? photo : undefined), 'text/html');
        style.textContent = [...parsed.querySelectorAll('style')].map(item => item.textContent).join('\n');
        source.className = parsed.querySelector('main').className; source.innerHTML = parsed.querySelector('main').innerHTML;
        await Promise.all([...source.querySelectorAll('img')].map(img => img.decode().catch(() => undefined)));
        const started = performance.now();
        try {
          const result = paginatePreview(doc, source, destination, { pageWidth: 794, pageHeight: 1123, marginPx: fixture.resume.appearance.marginPx, pageNumbers: fixture.resume.appearance.pageNumbers });
          const durationMs = performance.now() - started;
          const pages = [...destination.querySelectorAll('[data-preview-page]')];
          if (pages.some(item => Math.abs(item.getBoundingClientRect().height - 1123) > 1)) throw new Error('Incorrect A4 height');
          if (result.lineCuts || result.sourceLines !== result.renderedLines) throw new Error('Line coverage mismatch');
          const ids = [...destination.querySelectorAll('[id]')].map(item => item.id);
          if (new Set(ids).size !== ids.length) throw new Error('Duplicate IDs');
          reports.push({ id: fixture.id, pages: result.pages, durationMs, sourceLines: result.sourceLines, renderedLines: result.renderedLines, lineCuts: result.lineCuts, outputNodes: destination.querySelectorAll('*').length, warnings: result.warnings });
        } catch (error) { reports.push({ id: fixture.id, error: error.message }); }
      }
    } finally { iframe.remove(); }
    return reports;
  });
}
