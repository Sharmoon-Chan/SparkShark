import { paginationFixtures } from '../fixtures/pagination';
import { createExample, applyTemplate } from '../../src/domain/resume';
import { TEMPLATES } from '../../src/domain/templates';
import { defaultContentLayout } from '../../src/domain/contentLayout';
import { HTML_PREVIEW_SHELL, previewPhotoDataUrl, renderHtmlPreview } from '../../src/features/preview/htmlPreviewDocument';
import { createHtmlPreviewRuntime, type PreviewLayoutState } from '../../src/features/preview/htmlPreviewRuntime';
import type { Resume } from '../../src/domain/types';
import avatarUrl from '../../docs/fixtures/demo-avatar.png?url';

const frame = document.querySelector<HTMLIFrameElement>('#preview')!;
const status = document.querySelector('#status')!, report = document.querySelector('#report')!;
const ready = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
frame.srcdoc = HTML_PREVIEW_SHELL;
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  await ready;
  let latest: PreviewLayoutState | undefined;
  const doc = frame.contentDocument!;
  const photo = previewPhotoDataUrl({ data: new Uint8Array(await (await fetch(avatarUrl)).arrayBuffer()), width: 1, height: 1, mime: 'image/png' });
  const selectedCase = new URLSearchParams(location.search).get('case');
  const runtime = createHtmlPreviewRuntime(doc, { onLayout: state => { latest = state; }, onSelect() {} });
  const layout = async (resume: Resume, mode: boolean) => {
    const html = renderHtmlPreview(resume, resume.basics.avatarAssetId ? photo : undefined, mode), previous = latest?.revision ?? 0;
    runtime.update(html, resume, mode);
    const start = performance.now();
    while ((!latest || latest.revision === previous || latest.html !== html) && !latest?.error) {
      if (performance.now() - start > 10000) throw new Error('Layout wait timed out');
      await tick();
    }
    if (latest!.error) throw new Error(latest!.error);
    return latest!;
  };
  const stableFonts = async () => {
    const start = performance.now();
    while (doc.querySelector<HTMLElement>('#preview-pages')?.dataset.fontState !== 'ready') {
      if (performance.now() - start > 20000) throw new Error('Font wait timed out');
      await tick();
    }
    await tick(); await tick();
  };
  const geometry = () => [...doc.querySelectorAll('#preview-pages [data-preview-page]')].map(page => {
    const origin = page.getBoundingClientRect();
    const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT), range = doc.createRange();
    const rows: unknown[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      range.selectNodeContents(walker.currentNode);
      rows.push({ text: walker.currentNode.textContent, rects: [...range.getClientRects()].map(rect => [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height].map(n => Number(n.toFixed(2)))) });
    }
    return rows;
  });
  const output: { cases: unknown[]; timings: unknown[]; passed?: boolean; error?: string } = { cases: [], timings: [] };
  try {
    const cases = [...paginationFixtures(), ...TEMPLATES.map(template => ({ id: 'template-' + template.id, resume: applyTemplate(createExample(), template.id) }))];
    const configured = createExample('configured'); for (const section of configured.sections) section.contentLayout = defaultContentLayout(section);
    cases.push({ id: 'configured-every-section', resume: configured });
    for (const fixture of cases.filter(fixture => !selectedCase || fixture.id === selectedCase)) {
      status.textContent = `检查 ${fixture.id}`;
      await layout(fixture.resume, false); await stableFonts();
      const before = latest!, beforeText = doc.querySelector('#preview-pages')!.textContent, sourceText = doc.querySelector('#preview-source')!.textContent;
      assert(before.fields === undefined, 'Disabled mode measured field coordinates');
      const after = await layout(fixture.resume, true);
      assert(beforeText === doc.querySelector('#preview-pages')!.textContent, `${fixture.id}: toggle changed visible text`);
      assert(sourceText === doc.querySelector('#preview-source')!.textContent, `${fixture.id}: toggle changed source text`);
      assert(before.pages === after.pages && before.diagnostics!.sourceLines === after.diagnostics!.sourceLines && after.diagnostics!.lineCuts === 0, `${fixture.id}: toggle changed pagination`);
      for (const field of after.fields ?? []) {
        assert(field.x >= 0 && field.y >= 0 && field.x + field.width <= 794 * .75 + .1 && field.y + field.height <= 1123 * .75 + .1, `${fixture.id}: field escaped physical page`);
        assert(field.x >= field.columnX - .1 && field.x + field.width <= field.columnX + field.columnWidth + .1, `${fixture.id}: field escaped column`);
      }
      output.cases.push({ id: fixture.id, pages: after.pages, fields: after.fields?.length ?? 0, lineCuts: after.diagnostics!.lineCuts, fieldMs: after.fieldMeasurementMs, textPreserved: true });
    }
    for (const id of selectedCase ? [] : ['two-logical-groups', 'double-left-long-sidebar']) for (const mode of [false, true]) {
      status.textContent = `测量 ${id}，拖动模式 ${mode ? '开' : '关'}`;
      const resume = paginationFixtures().find(fixture => fixture.id === id)!.resume;
      await layout(resume, mode); await stableFonts();
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const next = structuredClone(resume); next.basics.name = '验证编辑 ' + (i % 2);
        const started = performance.now(); const result = await layout(next, mode); await tick();
        samples.push({ updateMs: performance.now() - started, fieldsMs: result.fieldMeasurementMs ?? 0 });
      }
      output.timings.push({ id, fieldMode: mode, pages: latest!.pages, samples });
    }
    // Exercise actual font reflow after entering the mode on the same document.
    const changed = createExample(); await layout(changed, true); changed.appearance.fontFamilyId = 'noto-serif-sc'; await layout(changed, true); await stableFonts();
    assert(latest!.fields!.length > 0, 'Fields did not refresh after font switch');
    assert(geometry().length === latest!.pages, 'Geometry/page metadata differs');
    output.passed = true; status.textContent = '全部通过';
  } catch (error) { output.passed = false; output.error = String(error); status.textContent = '验证失败'; }
  finally { runtime.dispose(); report.textContent = JSON.stringify(output, null, 2); }
};
