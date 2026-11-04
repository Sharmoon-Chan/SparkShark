import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { candidateFromDocxHtml, readDocxResume } from './docxImport';
import { resumeFromText } from './parsers';
import { parseResume, richText } from '../../domain/resume';
import { docxFixture, DOCX_MIME, headerFooterFixture, packDocx } from '../../../tests/fixtures/docx';

const fileFrom = (data: Uint8Array) => new File([new Uint8Array(data)], 'Word 测试.docx', { type: DOCX_MIME });

describe('Word content import', () => {
  it('reads a DOCX archive with header fields, two jobs, a nested list, a link, and a table', async () => {
    const result = await readDocxResume(fileFrom(docxFixture()));
    expect(result.candidate.basics).toMatchObject({ name: '林文档示例', headline: '前端工程师', phone: '000-0000-0000', email: 'word.demo@example.com', location: '上海市' });
    const work = result.candidate.groups.find(group => group.kind === 'work')!;
    expect(work.items).toHaveLength(2);
    expect(work.items![0].fields.company).toBe('示例科技公司');
    expect(work.items![1].fields.company).toBe('示例软件公司');
    const resume = resumeFromText(result.candidate, 'zh-CN');
    expect(() => parseResume(resume)).not.toThrow();
    for (const text of ['第一项职责', '嵌套任务', '第二项职责', '第二份工作的完整说明', '会议组织', '表格第二列的完整内容']) expect(JSON.stringify(resume)).toContain(text);
    expect(result.warnings.join('\n')).toContain('表格');
  });

  it('preserves bold, italic, underline, strike and hard breaks through conversion to editable data', async () => {
    const { candidate } = await readDocxResume(fileFrom(docxFixture()));
    const summary = candidate.groups.find(group => group.kind === 'summary')!.content;
    for (const mark of ['bold', 'italic', 'underline', 'strike']) expect(JSON.stringify(summary)).toContain(`"type":"${mark}"`);
    expect(JSON.stringify(summary)).toContain('"type":"hardBreak"');
    expect(JSON.stringify(summary)).toContain('https://example.com/portfolio?a=1&b=2');
    expect(richText(summary)).toContain('换行后内容');
  });

  it('retains referenced header and footer text while ignoring unused archive parts', async () => {
    const result = await readDocxResume(fileFrom(headerFooterFixture()));
    expect(result.candidate.basics.name).toBe('页眉示例');
    expect(result.candidate.basics.email).toBe('header.demo@example.com');
    const data = JSON.stringify(resumeFromText(result.candidate, 'zh-CN'));
    for (const phrase of ['页眉中的备注', '正文内容完整保留', '页脚中的完整备注']) expect(data).toContain(phrase);
    expect(result.sourceText).not.toContain('UNREFERENCED-HEADER-SECRET');
    expect(result.warnings.join('\n')).toContain('页眉页脚');
  });

  it('uses a single column for content without a sidebar and keeps nested text when remapping a module', () => {
    const { candidate } = candidateFromDocxHtml('<h1>工作经历</h1><h2>示例公司</h2><ul><li>第一层内容<ul><li>第二层内容</li></ul></li></ul>');
    const original = resumeFromText(candidate, 'zh-CN');
    expect(original.layout.mode).toBe('single'); expect(original.appearance.templateId).toBe('clean');
    candidate.groups[0].kind = 'skills';
    const remapped = resumeFromText(candidate, 'zh-CN'), data = JSON.stringify(remapped);
    expect(data).toContain('第一层内容'); expect(data).toContain('第二层内容');
    expect(remapped.layout.mode).toBe('double');
  });

  it('retains unknown headings as custom sections and subsection headings within a summary', () => {
    const { candidate } = candidateFromDocxHtml('<h1>个人总结</h1><h2>专业方向</h2><p><strong>中文正文</strong></p><h1>校园活动</h1><p>未知模块完整保留。</p>');
    const resume = resumeFromText(candidate, 'zh-CN');
    expect(candidate.groups).toHaveLength(2);
    expect(candidate.groups[0].content.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(resume.sections.find(section => section.kind === 'custom')?.titleOverride).toBe('校园活动');
    expect(() => parseResume(resume)).not.toThrow();
  });

  it('separates repeated company labels and keeps repeated nonprimary fields', () => {
    const { candidate } = candidateFromDocxHtml('<h1>工作经历</h1><p>公司：甲公司</p><p>职位：开发</p><p>职位：负责人</p><p>甲公司的详情。</p><p>公司：乙公司</p><p>职位：工程师</p><p>乙公司的详情。</p>');
    const work = candidate.groups[0];
    expect(work.items).toHaveLength(2);
    expect(work.items![0].fields.position).toBe('开发\n负责人');
    const text = JSON.stringify(resumeFromText(candidate, 'zh-CN'));
    for (const phrase of ['甲公司', '乙公司', '甲公司的详情', '乙公司的详情']) expect(text).toContain(phrase);
  });

  it('retains a deeper subsection heading within a job instead of inventing an extra job', () => {
    const { candidate } = candidateFromDocxHtml('<h1>工作经历</h1><h2>甲公司</h2><p>职位：工程师</p><h3>职责与成果</h3><p>甲公司的完整成果。</p><h2>乙公司</h2><p>乙公司的完整成果。</p>');
    const work = candidate.groups[0];
    expect(work.items).toHaveLength(2);
    expect(work.items![0].fields.company).toBe('甲公司'); expect(work.items![1].fields.company).toBe('乙公司');
    const summary = work.items![0].fields.summary;
    expect(JSON.stringify(summary)).toContain('职责与成果'); expect(JSON.stringify(summary)).toContain('"level":3');
    expect(() => resumeFromText(candidate, 'zh-CN')).not.toThrow();
  });

  it('separates bold company paragraphs without splitting a bold responsibility caption', () => {
    const { candidate } = candidateFromDocxHtml('<h1>工作经历</h1><p><strong>甲公司</strong></p><p>职位：工程师</p><p><strong>核心职责</strong></p><p>甲公司的完整成果。</p><p><strong>乙公司</strong></p><p>职位：实习生</p><p>乙公司的完整成果。</p>');
    const work = candidate.groups[0];
    expect(work.items).toHaveLength(2);
    expect(work.items![0].fields.company).toBe('甲公司'); expect(work.items![1].fields.company).toBe('乙公司');
    expect(JSON.stringify(work.items![0].fields.summary)).toContain('核心职责');
  });

  it('flattens all table cells in reading order and keeps nested lists valid', () => {
    const { candidate } = candidateFromDocxHtml('<h1>个人总结</h1><table><tr><td><p><em>甲</em></p><p>乙</p></td><td><ul><li>丙<ul><li>丁</li></ul></li></ul></td></tr></table><ol start="3"><li>戊</li></ol>');
    const summary = candidate.groups[0].content;
    expect(richText(summary)).toMatch(/甲[\s\S]*乙[\s\S]*丙[\s\S]*丁[\s\S]*戊/);
    expect(summary.content?.at(-1)).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    expect(() => resumeFromText(candidate, 'zh-CN')).not.toThrow();
  });

  it('extracts an embedded image without loading an external resource', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4fQAAAAASUVORK5CYII='), character => character.charCodeAt(0));
    const result = await readDocxResume(fileFrom(docxFixture(png)));
    expect(result.images).toHaveLength(1); expect(result.images[0].data).toEqual(png);
    expect(result.sourceText).toContain('[图片：测试照片]');
  });

  it('normalizes link protocols and drops active elements while keeping ordinary text', () => {
    const { candidate } = candidateFromDocxHtml('<h1>个人总结</h1><p>保留 &lt;script&gt; 文字，<a href="javascript:alert(1)">链接文字</a>。</p><script>恶意脚本</script><iframe src="https://example.com">外部内容</iframe><p><a href="https://example.com/a?x=1&amp;y=2">安全链接</a></p>');
    const data = JSON.stringify(resumeFromText(candidate, 'zh-CN'));
    expect(data).toContain('<script>'); expect(data).toContain('链接文字'); expect(data).toContain('https://example.com/a?x=1&y=2');
    expect(data).not.toContain('javascript:'); expect(data).not.toContain('恶意脚本'); expect(data).not.toContain('外部内容');
  });

  it('rejects corrupt archives, unrelated ZIP files, and empty or image-only documents', async () => {
    await expect(readDocxResume(fileFrom(strToU8('broken Word file')))).rejects.toThrow(/损坏/);
    await expect(readDocxResume(fileFrom(zipSync({ 'other.txt': strToU8('other') })))).rejects.toThrow(/有效/);
    await expect(readDocxResume(fileFrom(packDocx('<w:p/>')))).rejects.toThrow(/可编辑文字/);
    expect(() => candidateFromDocxHtml('<p><img src="myresume-image:test" alt="照片"></p>')).toThrow(/可编辑文字/);
  });

  it('enforces file and expanded archive limits before attempting document conversion', async () => {
    await expect(readDocxResume({ name: 'large.docx', size: 10 * 1024 * 1024 + 1, arrayBuffer: async () => { throw new Error('should not read'); } })).rejects.toThrow(/10 MB/);
    const archive = zipSync({ 'huge.xml': new Uint8Array(33 * 1024 * 1024) });
    await expect(readDocxResume(fileFrom(archive))).rejects.toThrow(/展开后过大/);
  });

  it('honors cancellation during file reading', async () => {
    const controller = new AbortController();
    await expect(readDocxResume({ name: 'cancel.docx', size: 1, arrayBuffer: async () => { controller.abort(); return new ArrayBuffer(1); } }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
