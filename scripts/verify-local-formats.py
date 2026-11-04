"""Inspect the real downloads from tests/browser/local-formats.js and verify-pdf.ts."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output'


def normalized(text: str) -> str:
    return re.sub(r'\s+', '', text)


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


class ExportHtml(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.text = []
        self.images = []
        self.links = []
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'body':
            self.in_body = True
        if tag == 'img':
            self.images.append(attributes.get('src', ''))
        if tag == 'a':
            self.links.append(attributes.get('href', ''))
        if tag == 'script':
            self.scripts += 1

    def handle_endtag(self, tag):
        if tag == 'body':
            self.in_body = False

    def handle_data(self, data):
        if self.in_body:
            self.text.append(data)


def inspect_pdf(path: Path) -> dict:
    reader = PdfReader(path)
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    outside = 0
    with pdfplumber.open(path) as document:
        for page in document.pages:
            assert abs(page.width - 595.2756) < .1 and abs(page.height - 841.8898) < .1
            outside += sum(char['x0'] < -.35 or char['x1'] > page.width + .35 or char['top'] < -.35 or char['bottom'] > page.height + .35 for char in page.chars)
    assert '\x00' not in text, f'NUL characters in {path.name}'
    assert outside == 0, f'Characters outside A4 in {path.name}'
    return {'pages': len(reader.pages), 'charactersOutsideA4': outside, 'nulCharacters': 0, 'text': text}


backup = json.loads((OUTPUT / 'playwright/docx-import-backup.json').read_text(encoding='utf-8'))
resume = backup['resumes'][0]
assert resume['basics']['name'] == 'Word 导入验收'
assert resume['basics']['phone'] == '000-0000-0000'
assert resume['layout']['mode'] == 'single' and resume['appearance']['templateId'] == 'clean'
work = next(section for section in resume['sections'] if section['kind'] == 'work')
assert [item['fields']['company'] for item in work['items']] == ['核对后的示例公司', '示例软件公司']
marks = {mark['type'] for node in objects(resume) for mark in node.get('marks', [])}
assert {'bold', 'italic', 'underline', 'strike', 'link'} <= marks
phrases = ['Word 导入验收', '000-0000-0000', '核对后的示例公司', '示例软件公司', '嵌套任务', '表格第二列的完整内容', '导入前核对补充']
serialized = json.dumps(resume, ensure_ascii=False)
assert all(phrase in serialized for phrase in phrases)
asset = next(asset for asset in backup['assets'] if asset['id'] == resume['basics']['avatarAssetId'])
photo = base64.b64decode(asset['dataBase64'], validate=True)
assert hashlib.sha256(photo).hexdigest() == asset['sha256']

html = ExportHtml()
html.feed((OUTPUT / 'playwright/resume-export.html').read_text(encoding='utf-8'))
assert all(normalized(phrase) in normalized(''.join(html.text)) for phrase in phrases)
assert html.scripts == 0
assert len(html.images) == 1 and html.images[0].startswith('data:image/')
html_photo = base64.b64decode(html.images[0].split(',', 1)[1], validate=True)
assert hashlib.sha256(html_photo).hexdigest() == asset['sha256']
assert all(re.match(r'^(https?|mailto|tel):', link) for link in html.links)

roundtrip = inspect_pdf(OUTPUT / 'playwright/docx-roundtrip.pdf')
assert all(normalized(phrase) in normalized(roundtrip['text']) for phrase in phrases)
roundtrip.pop('text')
regression = {}
for name, expected_pages in [('m0-example', 2), ('m0-long', 11), ('m0-formats', 1), ('m0-blank', 1)]:
    result = inspect_pdf(OUTPUT / f'pdf/{name}.pdf')
    assert result['pages'] == expected_pages
    if name == 'm0-example':
        assert '林示例' in result['text'] and '000-0000-0000' in result['text']
    result.pop('text')
    regression[name] = result

story = '中文内容应按完整行分页。持续改进界面体验、模块结构与可读性。'
with pdfplumber.open(OUTPUT / 'pdf/m0-long.pdf') as document:
    body = []
    for page in document.pages:
        margin, gap = 18 * .75, 20 * .75
        main_x = margin + (page.width - margin * 2 - gap) * .4 + gap
        body.append(page.crop((main_x - 2, 0, page.width, page.height - 20)).extract_text(x_tolerance=1, y_tolerance=2) or '')
    repeats = normalized('\n'.join(body)).count(story)
    assert repeats == 300, f'Long PDF lost paragraph text: {repeats} / 300'

report = {
    'backup': {'reviewedFields': True, 'twoJobs': True, 'richMarks': sorted(marks), 'photoHashMatches': True, 'singleColumn': True},
    'html': {'contentMatchesBackup': True, 'photoHashMatchesBackup': True, 'externalImageDependencies': 0, 'scripts': 0},
    'docxRoundtripPdf': roundtrip,
    'pdfRegression': regression,
    'longPdfParagraphRepeats': {'actual': repeats, 'expected': 300},
}
(OUTPUT / 'playwright/local-formats-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
