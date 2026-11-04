"""Check configured field order, alignment, visibility and long-body preservation."""
from pathlib import Path
import json
import re
import pdfplumber

directory = Path.cwd() / 'output' / 'content-layout'
compact = lambda text: re.sub(r'\s+', '', text)
report = []

for entry in json.loads((directory / 'render-report.json').read_text(encoding='utf-8')):
    name = entry['id']
    regions = json.loads((directory / f'{name}.regions.json').read_text(encoding='utf-8'))
    with pdfplumber.open(directory / f'{name}.pdf') as pdf:
        outside = sum(char['x0'] < -.3 or char['x1'] > page.width + .3 or char['top'] < -.3 or char['bottom'] > page.height + .3 for page in pdf.pages for char in page.chars)
        assert outside == 0, f'{name}: characters outside A4'
        text = compact(''.join(page.extract_text(use_text_flow=True) or '' for page in pdf.pages))
        assert '\0' not in text and '\ufffd' not in text and '🦄' not in text
        assert '林示例' in text

        def section_pages(label):
            for region in regions:
                if region['label'] == label:
                    page = pdf.pages[region['page'] - 1]
                    box = (max(0, region['x'] - .3), max(0, region['y'] - .3), min(page.width, region['x'] + region['width'] + .3), min(page.height, region['y'] + region['height'] + .3))
                    yield page.crop(box), region

        if name == 'hidden-fields':
            assert len(pdf.pages) == 1, 'hidden project page should not remain empty'
            assert '项目经历' not in text and '隐藏的未知字符' not in text
        elif '-long' in name:
            work_text = compact(''.join(page.extract_text(use_text_flow=True) or '' for page, _ in section_pages('工作经历')))
            phrase = '模块内部排版跨页正文应完整保留，字段排序不会修改实际内容。'
            assert work_text.count(phrase) == 144, f'{name}: {work_text.count(phrase)} / 144 body phrases'
            for i in range(1, 7):
                assert f'排版长文公司{i}' in work_text
            if name.endswith('rich-first'):
                first_page, _ = next(section_pages('工作经历'))
                first_text = compact(first_page.extract_text(use_text_flow=True) or '')
                assert '工作经历' in first_text and '模块内部排版跨页正文' in first_text, 'title should stay with the first body lines'
        else:
            work_page, _ = next(section_pages('工作经历'))
            role = work_page.search('系统研发工程师', regex=False)[0]
            company = work_page.search('排列验证示例公司', regex=False)[0]
            place = work_page.search('示例二区', regex=False)[0]
            assert role['top'] < company['top'] and abs(company['top'] - place['top']) < 3
            assert place['x0'] > company['x1']
            assert '配置后的工作正文完整保留。' in text
            assert '3.8/4.0' not in text, 'hidden score should not be printed'
            assert '自定义字段引用保留' in text and '自定义正文内容正常显示。' in text
            education_page, _ = next(section_pages('教育背景'))
            major = education_page.search('计算机科学与技术', regex=False)[0]
            school = education_page.search('示例大学', regex=False)[0]
            assert major['top'] < school['top'], 'major should precede the school row'
            summary_page, region = next(section_pages('个人总结'))
            centered = summary_page.search('富文本居中与加粗保留', regex=False)[0]
            assert abs((centered['x0'] + centered['x1']) / 2 - (region['x'] + region['width'] / 2)) < 2
            assert all('Bold' in char['fontname'] for char in centered['chars'])
        report.append({'file': name + '.pdf', 'pages': len(pdf.pages), 'outsideA4': outside, 'content': 'passed'})

(directory / 'content-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
