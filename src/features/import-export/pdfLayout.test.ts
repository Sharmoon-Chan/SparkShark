import { describe, expect, it } from 'vitest';
import { richText, parseResume } from '../../domain/resume';
import { candidateFromPdf, pdfLines, type PdfPageText, type PdfSpan } from './pdfLayout';
import { resumeFromText } from './parsers';

const span = (text: string, x: number, y: number, height = 11, bold = false, page = 1): PdfSpan => ({ text, x, y, height, bold, page, width: Math.min(text.length * height * .6, 310) });
const page = (spans: PdfSpan[], number = 1): PdfPageText => ({ number, width: 595, height: 842, spans });
describe('PDF resume layout and mapping', () => {
  it('maps common resume headings and keeps project stacks and wrapped skill descriptions', () => {
    const candidate = candidateFromPdf([page([
      span('导入测试', 20, 20, 24, true), span('后端开发实习生', 20, 50),
      span('个⼈情况', 20, 95, 15, true), span('示例大学 · 在读 · 可实习六个月', 20, 120),
      span('技术项⽬', 20, 160, 15, true), span('内容平台｜Java · Spring Cloud', 20, 190, 12), span('2026.04 - 2026.07', 430, 190), span('提供审核与检索功能。', 20, 215),
      span('智能体助手｜Spring AI · pgvector', 20, 260, 12), span('2026.09 - ⾄今', 430, 260), span('支持工具调用与知识检索。', 20, 285),
      span('个⼈技能', 20, 335, 15, true), span('Java 基础：熟悉 JVM 和线程池。', 20, 360), span('后端框架：熟悉 Spring Boot', 20, 390), span('及网关路由开发。', 20, 405),
      span('荣誉奖项', 20, 450, 15, true), span('学校综合奖学金', 20, 475), span('2023.10、2024.10、2025.10', 400, 475),
    ])], '真实格式');
    expect(candidate.groups.map(group => group.kind)).toEqual(['summary', 'projects', 'skills', 'awards']);
    const projects = candidate.groups.find(group => group.kind === 'projects')!;
    expect(projects.items).toHaveLength(2); expect(projects.items![0].fields.name).toBe('内容平台');
    expect(projects.items![0].fields.keywords).toEqual(['Java', 'Spring Cloud']);
    expect(projects.items![1].fields.dateText).toBe('2026.09 - 至今');
    expect(projects.items![1].fields.description).toBe('支持工具调用与知识检索。');
    const skills = candidate.groups.find(group => group.kind === 'skills')!;
    expect(skills.items).toHaveLength(2); expect(skills.items![0].fields.name).toBe('Java 基础');
    expect(skills.items![1].fields.description).toContain('及网关路由开发');
    expect(candidate.groups.find(group => group.kind === 'awards')!.items![0].fields.dateText).toBe('2023.10、2024.10、2025.10');
    expect(() => parseResume(resumeFromText(candidate, 'zh-CN'))).not.toThrow();
  });
  it('does not mistake phone digits or a version year for a date, and preserves unreadable date markers', () => {
    const candidate = candidateFromPdf([page([
      span('测试姓名', 20, 20, 24), span('13620231234', 20, 55),
      span('技术项目', 20, 95, 15), span('平台2025版', 20, 125, 12, true), span('����.�� - ����.��', 400, 125), span('项目原始简介。', 20, 150),
    ])], '日期测试');
    expect(candidate.basics.phone).toBe('13620231234');
    const item = candidate.groups.find(group => group.kind === 'projects')!.items![0];
    expect(item.fields.name).toBe('平台2025版'); expect(item.fields.dateText).toBe('����.�� - ����.��'); expect(item.fields.description).toBe('项目原始简介。');
    expect(candidate.warnings.some(warning => warning.kind === 'characters')).toBe(true);
  });
  it('reads basic fields and separates multiple work records', () => {
    const candidate = candidateFromPdf([page([
      span('林示例', 14, 20, 24, true), span('前端开发工程师', 14, 52), { ...span('000-0000-0000', 14, 78), url: 'tel:000-0000-0000' }, span('lin.demo@example.com', 150, 78),
      span('工作经历', 14, 130, 14, true), span('示例科技公司', 14, 163, 12, true), span('前端工程师', 14, 183), span('2024.01—至今', 14, 203), span('示例城市', 14, 223), span('维护组件与页面，所有内容为虚构。', 14, 249),
      span('第二示例公司', 14, 300, 12, true), span('开发工程师', 14, 320), span('2022.01—2023.12', 14, 340), span('完成浏览器本地工具开发。', 14, 365), span('1', 290, 827, 8),
    ])], '文件名');
    expect(candidate.basics.name).toBe('林示例'); expect(candidate.basics.headline).toBe('前端开发工程师'); expect(candidate.basics.phone).toBe('000-0000-0000'); expect(candidate.basics.email).toBe('lin.demo@example.com');
    const work = candidate.groups.find(group => group.kind === 'work')!;
    expect(work.items).toHaveLength(2); expect(work.items![0].fields.company).toBe('示例科技公司'); expect(work.items![0].fields.dateText).toBe('2024.01—至今');
    expect(richText(work.content)).not.toContain('\n1');
    expect(() => parseResume(resumeFromText(candidate, 'zh-CN'))).not.toThrow();
  });
  it('keeps main-column continuation together instead of mixing sidebar rows into it', () => {
    const first = page([span('林示例', 14, 20, 24, true), span('前端工程师', 14, 52), span('技能', 14, 125, 14, true), span('React', 14, 155, 12, true), span('组件化开发', 14, 175), span('TypeScript', 14, 195), span('语言', 14, 240, 14, true), span('中文', 14, 270), span('工作经历', 250, 125, 14, true), span('示例公司', 250, 155, 12, true), span('前端工程师', 250, 175), span('2024.01—至今', 250, 195), span('连续正文第一部分', 250, 220), span('接着写第二部分。', 250, 236)]);
    const second = page([span('跨页继续的工作正文。', 250, 30, 11, false, 2), span('第二示例公司', 250, 70, 12, true, 2), span('开发工程师', 250, 90, 11, false, 2), span('2021.01—2023.12', 250, 110, 11, false, 2)], 2);
    const candidate = candidateFromPdf([first, second], '双栏');
    expect(candidate.columns).toBe(2);
    const work = candidate.groups.find(group => group.kind === 'work')!;
    expect(richText(work.content)).toContain('跨页继续的工作正文'); expect(richText(work.content)).not.toContain('组件化开发'); expect(work.pages).toEqual([1, 2]);
  });
  it('flags raw compatibility characters rather than inventing corrected names or phone digits', () => {
    const candidate = candidateFromPdf([page([span('林⽰例', 14, 20, 24, true), span('个人总结', 14, 100, 14, true), span('原文包含特殊映射和\u0000不可识别数字。', 14, 130)])], '问题文件');
    expect(candidate.basics.name).toBe('林⽰例'); expect(candidate.warnings.some(warning => warning.kind === 'characters')).toBe(true);
  });
  it('does not combine unrelated text at the same height across a gutter', () => {
    const lines = pdfLines(page([span('技能', 14, 120, 14), span('工作经历', 260, 120, 14)]));
    expect(lines.map(line => line.text)).toEqual(['技能', '工作经历']);
  });
});
