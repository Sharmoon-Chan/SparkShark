import { alignmentFixtures } from '../fixtures/alignment';
import { HTML_PREVIEW_SHELL, renderHtmlPreview } from '../../src/features/preview/htmlPreviewDocument';
import { createHtmlPreviewRuntime, type PreviewLayoutState } from '../../src/features/preview/htmlPreviewRuntime';
import type { Resume } from '../../src/domain/types';
const frame = document.querySelector<HTMLIFrameElement>('#preview')!;
const status = document.querySelector('#status')!, report = document.querySelector('#report')!;
const ready = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
frame.srcdoc = HTML_PREVIEW_SHELL;
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  await ready;
  let latest: PreviewLayoutState | undefined;
  const doc = frame.contentDocument!;
  const runtime = createHtmlPreviewRuntime(doc, { onLayout: state => { latest = state; }, onSelect() {} });
  const layout = async (resume: Resume, enabled: boolean) => {
    const start = performance.now(), html = renderHtmlPreview(resume, undefined, enabled), serializeMs = performance.now() - start;
    const previous = latest?.revision ?? 0;
    runtime.update(html, resume, enabled);
    while ((!latest || latest.revision === previous || latest.html !== html || doc.querySelector<HTMLElement>('#preview-pages')?.dataset.fontState !== 'ready') && !latest?.error) {
      if (performance.now() - start > 20000) throw new Error('Layout or fonts did not settle');
      await tick();
    }
    await tick(); await tick();
    if (latest!.error) throw new Error(latest!.error);
    return { state: latest!, serializeMs, totalMs: performance.now() - start };
  };
  const output: { cases: unknown[]; passed?: boolean; error?: string } = { cases: [] };
  try {
    for (const fixture of alignmentFixtures()) {
      status.textContent = '检查 ' + fixture.id;
      const off = await layout(fixture.resume, false);
      const before = doc.querySelector('#preview-pages')!.textContent;
      const on = await layout(fixture.resume, true), state = on.state;
      assert(before === doc.querySelector('#preview-pages')!.textContent, fixture.id + ': toggling drag changed text');
      assert(off.state.pages === state.pages, fixture.id + ': toggling drag changed page count');
      assert(off.state.fields === undefined, 'Ordinary preview measured unused fields');
      assert(state.diagnostics!.lineCuts === 0, fixture.id + ': cut text line');
      for (const field of state.fields!) assert(field.x >= field.columnX - .5 && field.x + field.width <= field.columnX + field.columnWidth + .5, fixture.id + ': field outside column');
      const geometry = fixture.expected.map(expected => {
        const section = fixture.resume.sections.find(section => section.kind === expected.section)!;
        const fields = state.fields!.filter(field => field.sectionId === section.id && expected.keys.includes(field.fieldKey));
        assert(fields.length === expected.keys.length, fixture.id + ': missing expected fields');
        const left = Math.min(...fields.map(field => field.x)), right = Math.max(...fields.map(field => field.x + field.width));
        let x = fields[0].columnX, width = fields[0].columnWidth;
        if (expected.slot) { const [index, count] = expected.slot; width = (width - (count - 1) * 6) / count; x += index * (width + 6); }
        const error = expected.alignment === 'left' ? left - x : expected.alignment === 'right' ? right - x - width : (left + right) / 2 - x - width / 2;
        assert(Math.abs(error) < .7, fixture.id + ': alignment offset ' + error.toFixed(3) + 'pt');
        return { ...expected, errorPt: Number(error.toFixed(3)) };
      });
      const paragraphs = (fixture.paragraphs ?? []).map(expected => {
        const section = fixture.resume.sections.find(section => section.kind === 'summary')!;
        const scope = doc.querySelector('#preview-pages [data-preview-source-id="' + section.id + '"]') ?? doc.querySelector('#preview-pages');
        const element = [...scope!.querySelectorAll('p, pre')].find(element => element.textContent === expected.text)!;
        assert(element, 'Missing paragraph ' + expected.text);
        const alignment = doc.defaultView!.getComputedStyle(element).textAlign;
        assert(alignment === expected.alignment, fixture.id + ': paragraph alignment ' + alignment);
        return { text: expected.text, alignment };
      });
      output.cases.push({ id: fixture.id, pages: state.pages, fields: state.fields!.length, geometry, paragraphs, serializeMs: on.serializeMs, fieldMs: state.fieldMeasurementMs, layoutMs: state.durationMs, totalMs: on.totalMs, lineCuts: state.diagnostics!.lineCuts, togglePreserved: true });
    }
    output.passed = true; status.textContent = '全部通过';
  } catch (error) { output.passed = false; output.error = String(error); status.textContent = '验证失败'; }
  finally { runtime.dispose(); report.textContent = JSON.stringify(output, null, 2); }
};
