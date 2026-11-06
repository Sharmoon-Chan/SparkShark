import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { applyTemplate, createExample, plainRich } from '../../domain/resume';
import { TEMPLATES } from '../../domain/templates';
import { renderResumeHtml } from '../../rendering/html';
import { HTML_PREVIEW_SHELL, previewPhotoDataUrl, renderHtmlPreview } from './htmlPreviewDocument';

type Node = DefaultTreeAdapterTypes.Node;
const visit = (node: Node): Node[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(visit) : [])];
const elements = (html: string, tag: string) => visit(parse(html)).filter((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === tag);
const attr = (node: DefaultTreeAdapterTypes.Element, name: string) => node.attrs.find(item => item.name === name)?.value;
const text = (node: Node): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';

describe('instant HTML preview document', () => {
  it('boots a stable script-free shell with separate source, visual pages and one reading copy', () => {
    const mains = elements(HTML_PREVIEW_SHELL, 'main');
    expect(mains.map(node => attr(node, 'id'))).toEqual(['preview-source', 'preview-pages', 'preview-reading']);
    expect(attr(mains[0], 'aria-hidden')).toBe('true');
    expect(attr(mains[1], 'aria-hidden')).toBe('true');
    expect(attr(mains[2], 'aria-hidden')).toBeUndefined();
    const policy = attr(elements(HTML_PREVIEW_SHELL, 'meta').find(node => attr(node, 'http-equiv') === 'Content-Security-Policy')!, 'content')!;
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("font-src 'self' blob:");
    expect(elements(HTML_PREVIEW_SHELL, 'script')).toHaveLength(0);
  });
  it('preserves export content and column structure for every template without modifying the resume', () => {
    for (const template of TEMPLATES) {
      const resume = applyTemplate(createExample(), template.id), original = structuredClone(resume);
      const exported = renderResumeHtml(resume), preview = renderHtmlPreview(resume);
      expect(text(elements(preview, 'body')[0])).toBe(text(elements(exported, 'body')[0]));
      expect(elements(preview, 'aside')).toHaveLength(elements(exported, 'aside').length);
      expect(attr(elements(preview, 'main')[0], 'class')).toContain(`template-${template.id}`);
      expect(resume).toEqual(original);
      expect(renderResumeHtml(resume)).toBe(exported);
    }
  });

  it('keeps all long content in continuous layout groups instead of clipping to a claimed PDF page count', () => {
    const resume = createExample(), section = resume.sections.find(item => item.kind === 'summary');
    if (section?.kind !== 'summary') throw new Error('missing fixture');
    const long = '保留全部内容与标点。'.repeat(1200);
    section.content = plainRich(long);
    const html = renderHtmlPreview(resume);
    expect(text(elements(html, 'body')[0])).toContain(long);
    const extra = elements(html, 'style').find(node => node.attrs.some(item => item.name === 'data-quick-preview'))!;
    expect(text(extra)).not.toContain('max-height');
    expect(text(extra)).toContain('min-height:1123px');
  });

  it('allows only a locally encoded photo and does not alter the standalone photo export', () => {
    const resume = createExample(); resume.basics.avatarAssetId = 'photo'; resume.appearance.avatar.visible = true;
    const photo = { data: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' as const, width: 2, height: 3 };
    const url = previewPhotoDataUrl(photo), before = renderResumeHtml(resume, { photo });
    expect(attr(elements(renderHtmlPreview(resume, url), 'img')[0], 'src')).toBe(url);
    expect(renderResumeHtml(resume, { photo })).toBe(before);
    expect(() => renderHtmlPreview(resume, 'https://example.com/photo.png')).toThrow('预览照片格式无效');
    expect(() => renderHtmlPreview(resume, 'data:image/png;base64,AQ==" onerror="bad()')).toThrow('预览照片格式无效');
  });

  it('escapes user markup and forbids script, font, connection and external image loading', () => {
    const resume = createExample();
    resume.title = '</title><script>globalThis.injected=true</script>';
    resume.basics.name = '<img src=https://example.com/tracker onerror=bad()> & 姓名';
    resume.basics.website = 'javascript:bad()';
    const html = renderHtmlPreview(resume);
    expect(elements(html, 'script')).toHaveLength(0);
    expect(elements(html, 'link')).toHaveLength(0);
    expect(elements(html, 'img')).toHaveLength(0);
    expect(text(elements(html, 'h1')[0])).toBe(resume.basics.name);
    const policy = attr(elements(html, 'meta').find(node => attr(node, 'http-equiv') === 'Content-Security-Policy')!, 'content')!;
    expect(policy).toContain("script-src 'none'"); expect(policy).toContain("font-src 'none'");
    expect(policy).toContain("connect-src 'none'"); expect(policy).toContain('img-src data:');
    expect(html).not.toContain('@font-face');
    expect(elements(html, 'a').every(node => !attr(node, 'href')?.startsWith('javascript:'))).toBe(true);
  });
});
