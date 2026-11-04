"""Compare real template PDFs, including Chinese content and page bounds."""
from collections import Counter
import json
from pathlib import Path
import re
import pdfplumber
from PIL import Image, ImageDraw, ImageFont

directory = Path.cwd() / 'output' / 'template-review'

def compact(text):
    return re.sub(r'\s+', '', text)

def inspect(path):
    outside = []
    pieces = []
    with pdfplumber.open(path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            for char in page.chars:
                if char['x0'] < -.2 or char['x1'] > page.width + .2 or char['top'] < -.2 or char['bottom'] > page.height + .2:
                    outside.append({'page': page_index + 1, 'text': char['text'], 'box': [char['x0'], char['top'], char['x1'], char['bottom']]})
            # The renderer places page numbers below the body margin.
            pieces.append(page.crop((0, 0, page.width, page.height - 32)).extract_text(use_text_flow=True) or '')
        text = compact(''.join(pieces))
        return {'pages': len(pdf.pages), 'text': text, 'outside': outside}

baseline = inspect(directory / 'clean.pdf')
report = []
generated = {item['id'] for item in json.loads((directory / 'render-report.json').read_text(encoding='utf-8'))}
for path in sorted(path for path in directory.glob('*.pdf') if path.stem in generated):
    result = inspect(path)
    assert not result['outside'], f'{path.name}: text outside A4: {result["outside"][:3]}'
    assert '\0' not in result['text'] and '\ufffd' not in result['text'], f'{path.name}: unrecognized characters'
    assert '林示例' in result['text'] and '000-0000-0000' in result['text'], f'{path.name}: header text lost'
    if '-long' not in path.stem:
        # Single-column templates print levels as numbers; double-column templates draw bars.
        actual = re.sub(r'[1-5]/5', '', result['text']).replace('·', '')
        expected = re.sub(r'[1-5]/5', '', baseline['text']).replace('·', '')
        assert Counter(actual) == Counter(expected), f'{path.name}: content differs from clean baseline: {Counter(expected) - Counter(actual)}'
    else:
        phrase = '跨页核验正文应完整保留，中文标点与条目标题正确换行。'
        regions = json.loads(path.with_suffix('.regions.json').read_text(encoding='utf-8'))
        work_pieces = []
        with pdfplumber.open(path) as pdf:
            for region in regions:
                if region['label'] != '工作经历':
                    continue
                page = pdf.pages[region['page'] - 1]
                box = (max(0, region['x'] - .5), max(0, region['y'] - .5), min(page.width, region['x'] + region['width'] + .5), min(page.height - 32, region['y'] + region['height'] + .5))
                work_pieces.append(page.crop(box).extract_text(use_text_flow=True) or '')
        work_text = compact(''.join(work_pieces))
        assert work_text.count(phrase) == 144, f'{path.name}: long body count {work_text.count(phrase)} / 144'
        for index in range(1, 9):
            assert f'长文核验公司{index}' in result['text'], f'{path.name}: missing company {index}'
    report.append({'file': path.name, 'pages': result['pages'], 'characters': len(result['text']), 'bounds': 'passed', 'content': 'passed'})
(directory / 'content-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

comparisons = [
    ('six-template-comparison.jpg', ['essential', 'modern', 'modernSplit', 'gradient', 'reed', 'leafish']),
    ('new-template-comparison.jpg', ['executive', 'scholar', 'atelier', 'ledger', 'ribbon', 'aurora']),
]
new_template_names = {'executive': '领航', 'scholar': '学研', 'atelier': '艺线', 'ledger': '格序', 'ribbon': '锦带', 'aurora': '晨光'}
title_font = ImageFont.truetype(str(Path.cwd() / 'public/fonts/sans-700.ttf'), 20)
for filename, ids in comparisons:
    if not all((directory / f'{name}-1.png').exists() for name in ids):
        continue
    tile_width, tile_height = 445, 680
    sheet = Image.new('RGB', (tile_width * 3, tile_height * 2), '#edf0ed')
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(ids):
        screenshot = Image.open(directory / f'{name}-1.png').convert('RGB')
        screenshot.thumbnail((tile_width - 22, tile_height - 45))
        x, y = (index % 3) * tile_width, (index // 3) * tile_height
        draw.text((x + 12, y + 7), new_template_names.get(name, name), font=title_font, fill='#27312b')
        sheet.paste(screenshot, (x + 11, y + 34))
    sheet.save(directory / filename, quality=92)
