import json
import re
import subprocess
from pathlib import Path

import pdfplumber
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
output = root / 'output' / 'content-typography'
rendered = json.loads((output / 'render-report.json').read_text(encoding='utf-8'))
report = []

for case in rendered:
    document = json.loads((output / f"{case['name']}.resume.json").read_text(encoding='utf-8'))
    work = next(section for section in document['sections'] if section['kind'] == 'work')
    sizes = {field['key']: field.get('fontSizePx') for field in work['contentLayout']['fields']}
    with pdfplumber.open(output / f"{case['name']}.pdf") as pdf:
        margin = document['appearance']['marginPx'] * .75
        footer = max(24, margin / 2) + 12 if document['appearance']['pageNumbers'] else 0
        text = ''.join(page.crop((0, 0, page.width, page.height - max(margin, footer) + .2)).extract_text(use_text_flow=True) or '' for page in pdf.pages)
        assert '\x00' not in text
        assert all(char['x0'] >= -0.5 and char['x1'] <= page.width + 0.5 and char['top'] >= -0.5 and char['bottom'] <= page.height + 0.5 for page in pdf.pages for char in page.chars)
        assert '原有加粗保留' in text and '删除线保留' in text and '中文代码' in text

        def search(value):
            for page in pdf.pages:
                found = page.search(value, regex=False)
                if found:
                    return page, found[0]
            raise AssertionError(f'Missing text: {value}')

        def size(value, expected):
            page, found = search(value)
            assert all(abs(char['size'] - expected * 0.75) < 0.05 for char in found['chars']), (case['name'], value, expected)
            return page, found

        company = work['items'][0]['fields']['company']
        company_page, company_match = size(company, sizes['company'])
        assert all('Bold' in char['fontname'] and ('Oblique' in char['fontname'] or 'Italic' in char['fontname']) for char in company_match['chars'])
        _, role = size('字段字号准确验证', sizes['position'])
        size('2024.01-2026.11', sizes['dateText'])
        _, body = size('整段格式验证。', 16)
        assert all('Oblique' in char['fontname'] or 'Italic' in char['fontname'] for char in body['chars'])
        _, bold = search('原有加粗保留')
        assert all('Bold' in char['fontname'] for char in bold['chars'])

        def decorations(page, found):
            return [line for line in page.lines if min(line['x1'], found['x1']) - max(line['x0'], found['x0']) > (found['x1'] - found['x0']) * 0.6 and found['top'] - 1 <= line['top'] <= found['bottom'] + 3]

        assert decorations(company_page, company_match), 'Missing field underline'
        strike_page, strike = search('删除线保留')
        positions = {round(line['top'], 1) for line in decorations(strike_page, strike)}
        assert len(positions) >= 2, 'Field underline removed an inline strikethrough'
        assert any(annotation.get('uri') == 'https://example.com/rich-format' for page in pdf.pages for annotation in page.annots)
        if case['name'].startswith('long-'):
            phrase = '自定义字号与格式不应删减任何正文，跨页内容必须完整保留。'
            compact = re.sub(r'\s+', '', text)
            assert compact.count(phrase) == 144
        if case['name'] == 'large':
            assert len(pdf.pages) >= 2
            phrase = '大字号正文仍应正确换行与分页，完整文字需要保留。'
            assert re.sub(r'\s+', '', text).count(phrase) == 12
        report.append({'name': case['name'], 'pages': len(pdf.pages), 'fontSizes': 'passed', 'italic': 'passed', 'underline': 'passed', 'inlineMarks': 'preserved', 'body': 'complete'})

for name in ('serif', 'sans-double', 'large'):
    subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-scale-to', '1100', '-png', str(output / f'{name}.pdf'), str(output / name)], check=True, capture_output=True)
images = [Image.open(output / f'{name}-1.png').convert('RGB') for name in ('serif', 'sans-double', 'large')]
sheet = Image.new('RGB', (sum(image.width for image in images) + 80, max(image.height for image in images) + 60), '#edf1ef')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
x = 20
for title, image in zip(('宋体：字号、斜体、下划线', '黑体双栏：格式与局部标记', '大字号：正常跨页'), images):
    draw.text((x, 12), title, font=font, fill='#2c5941')
    sheet.paste(image, (x, 45)); x += image.width + 20
sheet.save(output / 'comparison.png')
(output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
