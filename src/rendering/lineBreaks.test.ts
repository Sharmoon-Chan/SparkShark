import { describe, expect, it } from 'vitest';
import { pdfWordBreaks } from './lineBreaks';

describe('PDF word breaks', () => {
  it('keeps Chinese closing punctuation off line starts and opening punctuation off line ends', () => {
    const input = '中文排版（保留括号）、句号。以及《书名》和“引号”，结束！';
    const parts = pdfWordBreaks(input).filter(Boolean);
    expect(parts.join('')).toBe(input);
    for (const part of parts) {
      expect(part).not.toMatch(/^[。，、；：！？）】》」』”’]/u);
      expect(part).not.toMatch(/[（【《「『“‘]$/u);
    }
  });

  it('preserves short Latin terms within Chinese and every character of long URLs', () => {
    const parts = pdfWordBreaks('使用React与TypeScript开发组件').filter(Boolean);
    expect(parts.some(part => part.includes('React'))).toBe(true);
    expect(parts.some(part => part.includes('TypeScript'))).toBe(true);
    const url = 'https://example.com/a-very-long-path?query=some-long-value&other=value';
    expect(pdfWordBreaks(url).join('')).toBe(url);
    expect(pdfWordBreaks(url).filter(Boolean).length).toBeGreaterThan(1);
    expect(pdfWordBreaks('000-0000-0000')).toEqual(['000-0000-0000']);
  });

  it('preserves graphemes, astral CJK characters, and explicit empty input', () => {
    const parts = pdfWordBreaks('中文𠀀与e\u0301以及👩‍💻字符').filter(Boolean);
    expect(parts.join('')).toBe('中文𠀀与e\u0301以及👩‍💻字符');
    expect(parts).toContain('e\u0301');
    expect(parts).toContain('👩‍💻');
    expect(pdfWordBreaks('')).toEqual(['']);
  });
});
