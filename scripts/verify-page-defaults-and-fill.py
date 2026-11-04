import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

import pdfplumber
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
output = root / 'output' / 'page-defaults'
report = json.loads((output / 'report.json').read_text(encoding='utf-8'))
verified = []


def inspect(name, document):
    appearance = document['appearance']
    margin = appearance['marginPx'] * 0.75
    with pdfplumber.open(output / name) as pdf:
        letters, images = [], []
        for page in pdf.pages:
            reserve = max(24, margin / 2) + 12 if appearance['pageNumbers'] else 0
            end = page.height - max(margin, reserve)
            for char in page.chars:
                assert '\x00' not in char['text'], (name, 'NUL')
                assert char['x0'] >= -0.5 and char['x1'] <= page.width + 0.5, (name, 'horizontal clipping')
                assert char['top'] >= -0.5 and char['bottom'] <= page.height + 0.5, (name, 'vertical clipping')
                if char['top'] < end:
                    letters.append(char['text'])
            images.extend(hashlib.sha256(image['stream'].get_data()).hexdigest() for image in page.images)
        first = pdf.pages[0]
        header = [char for char in first.chars if char['top'] < 150 and char['text'].strip()]
        left = min(char['x0'] for char in header)
        return {'pages': len(pdf.pages), 'letters': Counter(re.sub(r'\s+', '', ''.join(letters))), 'images': sorted(images), 'left': left}


for case in report:
    before_document = json.loads((output / f"{case['id']}-before.resume.json").read_text(encoding='utf-8'))
    after_document = json.loads((output / f"{case['id']}-after.resume.json").read_text(encoding='utf-8'))
    before = inspect(f"{case['id']}-before.pdf", before_document)
    after = inspect(f"{case['id']}-after.pdf", after_document)
    assert before['letters'] == after['letters'], (case['id'], 'text changed', before['letters'] - after['letters'], after['letters'] - before['letters'])
    assert before['images'] == after['images'], (case['id'], 'avatar changed')
    assert after['pages'] == 1
    verified.append({'id': case['id'], 'contentUnchanged': True, 'avatarUnchanged': True, 'characters': sum(after['letters'].values()), 'pages': after['pages'], 'beforeUsage': case.get('beforeUsage'), 'afterUsage': case['afterUsage']})

for preset in ('compact', 'standard', 'loose'):
    document = json.loads((output / f'density-{preset}.resume.json').read_text(encoding='utf-8'))
    pdf = inspect(f'density-{preset}.pdf', document)
    assert abs(pdf['left'] - document['appearance']['marginPx'] * 0.75) < 0.5, (preset, 'margin differs')

if (output / 'browser-restored.json').exists():
    before_backup = json.loads((output / 'browser-before.json').read_text(encoding='utf-8'))
    after_backup = json.loads((output / 'browser-after.json').read_text(encoding='utf-8'))
    restored_backup = json.loads((output / 'browser-restored.json').read_text(encoding='utf-8'))
    before_document, after_document = before_backup['resumes'][0], after_backup['resumes'][0]
    assert before_document['basics'] == after_document['basics']
    assert before_document['layout'] == after_document['layout']
    assert [{key: value for key, value in section.items() if key != 'contentLayout'} for section in before_document['sections']] == [{key: value for key, value in section.items() if key != 'contentLayout'} for section in after_document['sections']]
    ignore = ('revision', 'updatedAt')
    assert {key: value for key, value in before_document.items() if key not in ignore} == {key: value for key, value in restored_backup['resumes'][0].items() if key not in ignore}, 'Browser restoration differs'
    assert sorted(asset['sha256'] for asset in before_backup['assets']) == sorted(asset['sha256'] for asset in after_backup['assets'])
    before_pdf, after_pdf = inspect('browser-before.pdf', before_document), inspect('browser-after.pdf', after_document)
    assert before_pdf['letters'] == after_pdf['letters']
    assert before_pdf['images'] == after_pdf['images']
    assert before_pdf['pages'] == after_pdf['pages'] == 1
    verified.append({'id': 'browser', 'contentUnchanged': True, 'avatarUnchanged': True, 'formatRestored': True, 'characters': sum(after_pdf['letters'].values()), 'pages': 1})

font_file = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_file), 24)
small_font = ImageFont.truetype(str(font_file), 18)


def render(name):
    target = output / Path(name).stem
    subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-scale-to', '1000', '-png', str(output / name), str(target)], check=True, capture_output=True)
    return Image.open(str(target) + '-1.png').convert('RGB')


def comparison(left_name, right_name, left_caption, right_caption, filename):
    left, right = render(left_name), render(right_name)
    width = left.width + right.width + 72
    image = Image.new('RGB', (width, max(left.height, right.height) + 100), '#edf1ef')
    draw = ImageDraw.Draw(image)
    draw.text((24, 14), left_caption, font=font, fill='#243f31')
    draw.text((left.width + 48, 14), right_caption, font=font, fill='#176c4d')
    image.paste(left, (24, 65)); image.paste(right, (left.width + 48, 65))
    image.save(output / filename)


single = next(case for case in report if case['id'] == 'single')
comparison('single-before.pdf', 'single-after.pdf', f"调整前：约 {single['beforeUsage']:.0%}，一页", f"智能铺满：约 {single['afterUsage']:.0%}，一页", 'fill-comparison.png')
comparison('density-old-46.pdf', 'density-standard.pdf', '原标准外边距：46px', 'TalenCat 标准：18px', 'margin-comparison.png')

tiles = []
for case in report:
    page = render(f"{case['id']}-after.pdf")
    page.thumbnail((360, 510))
    tile = Image.new('RGB', (390, 550), '#edf1ef')
    draw = ImageDraw.Draw(tile)
    draw.text((15, 8), f"{case['id']}  {case['afterUsage']:.0%}", font=small_font, fill='#243f31')
    tile.paste(page, (15, 36)); tiles.append(tile)
grid = Image.new('RGB', (1170, 1100), '#edf1ef')
for index, tile in enumerate(tiles):
    grid.paste(tile, ((index % 3) * 390, (index // 3) * 550))
grid.save(output / 'all-cases.png')
(output / 'content-report.json').write_text(json.dumps(verified, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(verified, ensure_ascii=False))
