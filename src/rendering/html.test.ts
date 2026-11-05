import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { RichDocument } from '../domain/types';
import { applyTemplate, createExample, createResume, newItem, plainRich, uid } from '../domain/resume';
import { FIELD_SPECS, ITEM_KINDS } from '../domain/registry';
import { renderResumeHtml } from './html';
import { defaultContentLayout } from '../domain/contentLayout';
import { TEMPLATES } from '../domain/templates';

type HtmlNode = DefaultTreeAdapterTypes.Node;
const nodes = (node: HtmlNode): HtmlNode[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(nodes) : [])];
const elements = (html: string, tag: string) => nodes(parse(html)).filter((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === tag);
const attr = (node: DefaultTreeAdapterTypes.Element, name: string) => node.attrs.find(attribute => attribute.name === name)?.value;
const text = (node: HtmlNode): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';

describe('standalone HTML export', () => {
  it('applies field typography without changing content, links or rich inline formatting', () => {
    const resume = createExample(), work = resume.sections.find(section => section.kind === 'work')!;
    if (work.kind !== 'work') throw new Error('fixture');
    work.contentLayout = defaultContentLayout(work);
    Object.assign(work.contentLayout.fields.find(field => field.key === 'company')!, { fontSizePx: 18, italic: true, underline: true, emphasis: 'muted' });
    Object.assign(work.contentLayout.fields.find(field => field.key === 'summary')!, { fontSizePx: 16, italic: true, underline: true });
    work.items[0].fields.summary = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '原有加粗保留', marks: [{ type: 'bold' }] },
      { type: 'text', text: '原有删除线保留', marks: [{ type: 'strike' }] },
      { type: 'text', text: '链接保留', marks: [{ type: 'link', attrs: { href: 'https://example.com/format' } }] },
    ] }] };
    const original = structuredClone(resume), html = renderResumeHtml(resume);
    const fields = elements(html, 'div').filter(node => attr(node, 'data-field-key'));
    const company = fields.find(node => attr(node, 'data-field-key') === 'company')!;
    expect(attr(company, 'style')).toContain('font-size:18px;'); expect(attr(company, 'style')).not.toContain('font-size:.92em;');
    expect(attr(company, 'style')).toContain('font-style:italic;'); expect(attr(company, 'style')).toContain('text-decoration:underline;');
    const body = fields.find(node => attr(node, 'data-field-key') === 'summary')!;
    expect(attr(body, 'style')).toContain('font-size:16px;');
    const inherited = fields.find(node => attr(node, 'data-field-key') === 'position')!;
    expect(attr(inherited, 'style')).toContain(`font-size:${resume.appearance.fontSizePx}px;`);
    expect(elements(html, 'strong').map(text)).toContain('原有加粗保留'); expect(elements(html, 's').map(text)).toContain('原有删除线保留');
    expect(elements(html, 'a').some(node => attr(node, 'href') === 'https://example.com/format')).toBe(true);
    expect(resume).toEqual(original);
  });
  it('retains all textual fields when every built-in kind uses compact item headers', () => {
    const resume = createResume(); resume.layout.mode = 'single';
    const expected: string[] = [];
    for (const kind of ITEM_KINDS) {
      const section = resume.sections.find(section => section.kind === kind)!;
      if (section.kind === 'summary' || section.kind === 'custom') continue;
      const item = newItem(kind);
      for (const field of FIELD_SPECS[kind]) {
        const label = `${kind}.${field.key}`;
        if (field.type === 'level') item.fields[field.key] = 3;
        else if (field.type === 'tags') { item.fields[field.key] = [label + '.one', label + '.two']; expected.push(label + '.one', label + '.two'); }
        else if (field.type === 'rich') { item.fields[field.key] = plainRich(label); expected.push(label); }
        else { const value = field.type === 'url' ? `https://example.com/${label}` : label; item.fields[field.key] = value; if (field.key !== 'iconId') expected.push(value); }
      }
      section.items = [item];
    }
    const body = text(elements(renderResumeHtml(resume), 'body')[0]);
    for (const value of expected) expect(body).toContain(value);
    expect(body.replace(/\s/g, '')).toContain('3/5');
  });
  it('retains visible content in manual page and column order while omitting hidden data', () => {
    const resume = createExample();
    resume.basics.customFields.push({ id: uid('field'), iconId: 'mail', label: '隐藏基本信息', value: 'HIDDEN-BASIC', visible: false });
    const work = resume.sections.find(section => section.kind === 'work')!;
    if (work.kind === 'work') { const hidden = newItem('work'); hidden.fields.company = 'HIDDEN-ITEM'; hidden.visible = false; work.items.push(hidden); }
    const hiddenSection = resume.sections.find(section => !section.visible)!; hiddenSection.titleOverride = 'HIDDEN-SECTION';
    const html = renderResumeHtml(resume), body = text(elements(html, 'body')[0]);
    expect(body).toContain(resume.basics.name); expect(body).toContain('示例科技公司');
    expect(body).not.toContain('HIDDEN-BASIC'); expect(body).not.toContain('HIDDEN-ITEM'); expect(body).not.toContain('HIDDEN-SECTION');
    const groups = elements(html, 'article'); expect(groups).toHaveLength(2);
    const sectionIds = elements(html, 'section').map(section => attr(section, 'id'));
    const placed = resume.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
    expect(sectionIds).toEqual(placed.filter(id => sectionIds.includes(id)));
  });

  it('escapes user text, titles, and attributes and only emits supported links', () => {
    const resume = createResume('</title><script>window.injected=true</script>');
    resume.basics.name = '<img src=x onerror=alert(1)> & "姓名"';
    resume.basics.website = 'javascript:alert(1)';
    const work = resume.sections.find(section => section.kind === 'work')!;
    if (work.kind === 'work') { const item = newItem('work'); item.fields.company = '</h3><script>bad()</script>'; item.fields.url = 'https://example.com/?x="&y=<'; work.items.push(item); }
    const html = renderResumeHtml(resume);
    expect(elements(html, 'script')).toHaveLength(0); expect(elements(html, 'img')).toHaveLength(0);
    expect(text(elements(html, 'h1')[0])).toBe(resume.basics.name);
    expect(text(elements(html, 'title')[0])).toBe(resume.title);
    expect(elements(html, 'a').every(link => /^https?:|^mailto:|^tel:/.test(attr(link, 'href') ?? ''))).toBe(true);
  });

  it('preserves rich marks, numbered and nested lists, headings, alignment, and code newlines', () => {
    const resume = createResume(), summary = resume.sections.find(section => section.kind === 'summary')!;
    const content: RichDocument = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: '详细说明' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '全部格式', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'highlight' }, { type: 'code' }, { type: 'link', attrs: { href: 'https://example.com' } }] }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套内容' }] }] }] }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;\n中文代码' }] },
    ] };
    if (summary.kind === 'summary') summary.content = content;
    const html = renderResumeHtml(resume);
    for (const tag of ['strong', 'em', 'u', 's', 'mark', 'code', 'br', 'ul', 'ol', 'h4', 'pre']) expect(elements(html, tag).length).toBeGreaterThan(0);
    expect(attr(elements(html, 'ol')[0], 'start')).toBe('3');
    expect(attr(elements(html, 'h4')[0], 'style')).toBe('text-align:center');
    expect(text(elements(html, 'pre')[0])).toBe('const a = 1;\n中文代码');
  });

  it('embeds the prepared photo and has no external scripts, styles, or image dependencies', () => {
    const resume = createExample(); resume.basics.avatarAssetId = 'photo';
    const html = renderResumeHtml(resume, { photo: { data: new Uint8Array([1, 2, 3]), mime: 'image/png', width: 1, height: 1 } });
    expect(attr(elements(html, 'img')[0], 'src')).toBe('data:image/png;base64,AQID');
    expect(elements(html, 'link')).toHaveLength(0); expect(elements(html, 'script')).toHaveLength(0);
    expect(elements(html, 'meta').some(node => attr(node, 'http-equiv') === 'Content-Security-Policy')).toBe(true);
  });

  it('omits invisible custom fields while retaining rich content and visible custom URLs', () => {
    const resume = createResume(), id = uid('section'), nameId = uid('field'), richId = uid('field'), linkId = uid('field'), hiddenId = uid('field');
    resume.sections.push({ id, kind: 'custom', titleOverride: '自定义栏目', visible: true,
      fieldDefinitions: [{ id: nameId, type: 'name', label: '名称', visible: true }, { id: richId, type: 'summary', label: '说明', visible: true }, { id: linkId, type: 'url', label: '链接', visible: true }, { id: hiddenId, type: 'description', label: '隐藏', visible: false }],
      items: [{ id: uid('item'), visible: true, values: { [nameId]: '项目标题', [richId]: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '自定义加粗', marks: [{ type: 'bold' }] }] }] }, [linkId]: 'https://example.com', [hiddenId]: 'PRIVATE-CUSTOM' } }] });
    resume.layout.groups[0].main.push(id);
    const html = renderResumeHtml(resume);
    expect(text(elements(html, 'body')[0])).toContain('项目标题'); expect(text(elements(html, 'strong')[0])).toBe('自定义加粗');
    expect(text(elements(html, 'body')[0])).not.toContain('PRIVATE-CUSTOM');
  });

  it('supports each template and single columns without changing the input resume', () => {
    for (const template of TEMPLATES) {
      const resume = applyTemplate(createExample(), template.id);
      const before = structuredClone(resume), html = renderResumeHtml(resume);
      expect(html).toContain('template-' + template.id); expect(resume).toEqual(before);
      expect(elements(html, 'aside').length).toBe(resume.layout.mode === 'single' ? 0 : 2);
      const body = text(elements(html, 'body')[0]);
      expect(body).toContain('示例科技公司'); expect(body).toContain(resume.basics.name);
      expect(elements(html, 'script')).toHaveLength(0); expect(elements(html, 'link')).toHaveLength(0);
    }
  });

  it('exports an empty resume as a readable blank document without fabricated content', () => {
    const html = renderResumeHtml(createResume());
    expect(elements(html, 'article')).toHaveLength(1);
    expect(text(elements(html, 'body')[0]).trim()).toBe('');
  });
});
