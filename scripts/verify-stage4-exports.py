"""Inspect actual PDF bytes against the generated HTML sections and render review sheets.

Run after verify-stage4-exports.ts, using Python 3.10+, pdfplumber, pypdf,
Pillow, and Poppler's pdftoppm on PATH. All fixtures are synthetic.
"""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess

import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
directory = root / 'output' / 'stage4' / 'exports'
rendered = json.loads((directory / 'render-report.json').read_text(encoding='utf-8'))
report, failures = [], []


def compact(value):
    return re.sub(r'\s+', '', value)


def content_characters(value):
    # Generated list markers and proficiency graphics differ between renderers.
    value = re.sub(r'(?<!\S)\d+\.\s+', '', value)
    value = re.sub(r'[1-5]\s*/\s*5', '', value)
    return Counter(re.sub(r'[\s\u2022\u00b7]', '', value))


def fonts_in_resources(resources, seen=None):
    seen = set() if seen is None else seen
    result = []
    if not resources:
        return result
    resources = resources.get_object()
    for ref in resources.get('/Font', {}).get_object().values() if '/Font' in resources else []:
        font = ref.get_object()
        identity = str(font.get('/BaseFont', ''))
        if identity in seen:
            continue
        seen.add(identity)
        actual = font.get('/DescendantFonts', [font])[0].get_object()
        descriptor = actual.get('/FontDescriptor')
        descriptor = descriptor.get_object() if descriptor else {}
        result.append({'name': identity, 'embedded': any(key in descriptor for key in ('/FontFile', '/FontFile2', '/FontFile3'))})
    for ref in resources.get('/XObject', {}).get_object().values() if '/XObject' in resources else []:
        obj = ref.get_object()
        result.extend(fonts_in_resources(obj.get('/Resources'), seen))
    return result


for case in rendered:
    name = case['id']
    pdf_path = directory / (name + '.pdf')
    html = (directory / (name + '.html')).read_text(encoding='utf-8')
    regions = json.loads((directory / (name + '.regions.json')).read_text(encoding='utf-8'))
    checks = []
    with pdfplumber.open(pdf_path) as pdf:
        all_text = ''.join(page.extract_text(use_text_flow=True) or '' for page in pdf.pages)
        outside = [{'page': i + 1, 'text': char['text'], 'bounds': [round(char[key], 2) for key in ('x0', 'top', 'x1', 'bottom')]}
                   for i, page in enumerate(pdf.pages) for char in page.chars
                   if char['x0'] < -.5 or char['x1'] > page.width + .5 or char['top'] < -.5 or char['bottom'] > page.height + .5]
        if outside:
            failures.append({'id': name, 'issue': 'characters outside page', 'examples': outside[:5]})
        if '\0' in all_text or '\ufffd' in all_text:
            failures.append({'id': name, 'issue': 'unrecognized characters'})
        if len(pdf.pages) != case['pages']:
            failures.append({'id': name, 'issue': 'PDF page metadata mismatch'})
        for section in case['expectedSections']:
            snippets = []
            for region in regions:
                if region['target'] != section['id']:
                    continue
                page = pdf.pages[region['page'] - 1]
                box = (max(0, region['x'] - .4), max(0, region['y'] - .4),
                       min(page.width, region['x'] + region['width'] + .4),
                       min(page.height, region['y'] + region['height'] + .4))
                snippets.append(page.crop(box).extract_text(use_text_flow=True) or '')
            actual, expected = content_characters('\n'.join(snippets)), content_characters(section['text'])
            missing, extra = expected - actual, actual - expected
            checks.append({'sectionId': section['id'], 'expectedCharacterCount': sum(expected.values()), 'actualCharacterCount': sum(actual.values()), 'missing': dict(missing), 'extra': dict(extra)})
            if missing or extra:
                failures.append({'id': name, 'issue': 'section text differs from HTML', 'section': section['id'], 'missing': dict(missing), 'extra': dict(extra)})
        for hidden in case['hiddenSentinels']:
            if hidden in all_text or hidden in html:
                failures.append({'id': name, 'issue': 'hidden content exported', 'text': hidden})
        image_count = sum(len(page.images) for page in pdf.pages)
        if case['photo'] and (image_count == 0 or 'data:image/png;base64,' not in html):
            failures.append({'id': name, 'issue': 'photo missing from PDF/HTML'})
        links = [annotation.get('uri') for page in pdf.pages for annotation in page.annots or [] if annotation.get('uri')]
        mark_fonts = {}
        if case['marks']:
            for phrase in ('RegularBody', 'BoldBody', 'ItalicBody'):
                hits = [hit for page in pdf.pages for hit in page.search(phrase, regex=False)]
                mark_fonts[phrase] = sorted({char['fontname'] for hit in hits for char in hit['chars']})
                if not hits:
                    failures.append({'id': name, 'issue': 'mark phrase missing', 'text': phrase})
            if mark_fonts['RegularBody'] == mark_fonts['BoldBody'] or not any('Bold' in font for font in mark_fonts['BoldBody']):
                failures.append({'id': name, 'issue': 'bold does not use a separate bold font', 'fonts': mark_fonts})
            if not any('Oblique' in font or 'Italic' in font for font in mark_fonts['ItalicBody']):
                failures.append({'id': name, 'issue': 'italic font missing', 'fonts': mark_fonts})
            if 'https://example.com/stage4-verification' not in links:
                failures.append({'id': name, 'issue': 'clickable link annotation missing'})
        if name == 'stress-single-long-paragraph':
            phrase = '分页应保留完整的中文标点与所有字符，并避免把任意一行文字从中间裁断。'
            work = next(section for section in case['expectedSections'] if phrase in section['text'])
            parts = []
            for region in regions:
                if region['target'] == work['id']:
                    page = pdf.pages[region['page'] - 1]
                    parts.append(page.crop((region['x'] - .1, region['y'] - .1, region['x'] + region['width'] + .1, region['y'] + region['height'] + .1)).extract_text(use_text_flow=True) or '')
            actual_repetitions = compact(''.join(parts)).count(phrase)
            if actual_repetitions != 340:
                failures.append({'id': name, 'issue': 'long paragraph repetition count', 'actual': actual_repetitions, 'expected': 340})
        if name == 'stress-list-code-marks':
            orphan_markers = []
            for page_index, page in enumerate(pdf.pages):
                words = page.extract_words()
                for word in words:
                    if not re.fullmatch(r'\d+\.', word['text']):
                        continue
                    companions = [other for other in words if other['x0'] >= word['x1'] and abs(other['top'] - word['top']) < 2]
                    if not companions:
                        orphan_markers.append({'page': page_index + 1, 'marker': word['text'], 'top': round(word['top'], 2)})
            if orphan_markers:
                failures.append({'id': name, 'issue': 'list markers separated from first content line', 'markers': orphan_markers})
            for token in ('条目65：', '//codeline80:中文注释须逐行保留', '富文本结束。'):
                if token not in compact(all_text):
                    failures.append({'id': name, 'issue': 'last rich text segment missing', 'text': token})
        fonts = []
        for page in PdfReader(pdf_path).pages:
            fonts.extend(fonts_in_resources(page.get('/Resources')))
        standard_fonts = {'/Helvetica', '/Helvetica-Bold', '/Helvetica-Oblique', '/Helvetica-BoldOblique', '/Times-Roman', '/Times-Bold', '/Times-Italic', '/Times-BoldItalic', '/Courier', '/Courier-Bold', '/Courier-Oblique', '/Courier-BoldOblique', '/Symbol', '/ZapfDingbats'}
        unembedded = sorted({font['name'] for font in fonts if not font['embedded'] and font['name'] not in standard_fonts})
        if unembedded:
            failures.append({'id': name, 'issue': 'nonstandard fonts not embedded', 'fonts': unembedded})
        report.append({'id': name, 'pages': len(pdf.pages), 'characters': len(compact(all_text)), 'outsidePage': len(outside), 'images': image_count, 'linkCount': len(links), 'fonts': sorted({font['name'] for font in fonts}), 'allNonstandardFontsEmbedded': not unembedded, 'markFonts': mark_fonts, 'sectionChecks': checks})

(directory / 'verification.json').write_text(json.dumps({'results': report, 'failures': failures}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Contact sheets supplement text/bounds checks; they do not establish pixel equality.
templates = [case for case in rendered if case['id'].startswith('template-')]
representatives = [(case['id'], 1) for case in templates]
representatives += [(case['id'], page) for case in rendered if case['id'].startswith('stress-') for page in (1, case['pages'])]
representatives += [(case['id'], 1) for case in rendered if case['id'].startswith('font-')]
for name, number in representatives:
    prefix = directory / f'{name}-page{number}'
    subprocess.run(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile', '-scale-to', '1100', '-png', str(directory / f'{name}.pdf'), str(prefix)], check=True, capture_output=True)

label_font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)
for index in range(0, len(representatives), 6):
    group = representatives[index:index + 6]
    sheet = Image.new('RGB', (1200, 1200), '#e8eceb')
    draw = ImageDraw.Draw(sheet)
    for item_index, (name, number) in enumerate(group):
        screenshot = Image.open(directory / f'{name}-page{number}.png').convert('RGB')
        screenshot.thumbnail((380, 558))
        x, y = item_index % 3 * 400, item_index // 3 * 600
        draw.text((x + 10, y + 7), f'{name} / {number}', font=label_font, fill='#263a32')
        sheet.paste(screenshot, (x + 10, y + 33))
    sheet.save(directory / f'review-sheet-{index // 6 + 1}.png')
print(json.dumps({'cases': len(report), 'pdfPages': sum(item['pages'] for item in report), 'sectionComparisons': sum(len(item['sectionChecks']) for item in report), 'failureCount': len(failures), 'failures': failures[:12], 'reviewSheets': (len(representatives) + 5) // 6}, ensure_ascii=False, indent=2))
raise SystemExit(1 if failures else 0)
