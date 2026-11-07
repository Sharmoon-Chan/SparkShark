"""Independent text-coordinate and content checks for synthetic alignment PDFs."""
import json
from pathlib import Path
import pdfplumber

out = Path('output/preview-alignment')
records = json.loads((out / 'render-report.json').read_text(encoding='utf-8'))
report = []
for record in records:
    name = record['id']
    resume = json.loads((out / f'{name}.resume.json').read_text(encoding='utf-8'))
    fields = json.loads((out / f'{name}.fields.json').read_text(encoding='utf-8'))
    with pdfplumber.open(out / f'{name}.pdf') as pdf:
        text = ''.join(page.extract_text(use_text_flow=True) or '' for page in pdf.pages)
        compact = ''.join(text.split())
        outside = sum(c['x0'] < -.4 or c['x1'] > page.width + .4 or c['top'] < -.4 or c['bottom'] > page.height + .4 for page in pdf.pages for c in page.chars)
        assert outside == 0, f'{name}: characters outside A4'
        for label in ['默认段落对齐', '原有左对齐段落', '原有居中段落', 'CodeAlignment', '列表内容完整保留', 'TypeScript', '技能描述保持原有样式。']:
            assert label in compact, f'{name}: missing {label}'
        assert '\x00' not in text and '\ufffd' not in text
        if record.get('repetitions'):
            education = next(section for section in resume['sections'] if section['kind'] == 'education')
            segments = []
            for field in fields:
                if field['sectionId'] != education['id'] or field['fieldKey'] != 'summary':
                    continue
                page = pdf.pages[field['page'] - 1]
                box = (max(0, field['x'] - .5), max(0, field['y'] - .5), min(page.width, field['x'] + field['width'] + .5), min(page.height, field['y'] + field['height'] + .5))
                segments.append(page.crop(box).extract_text(use_text_flow=True) or '')
            body = ''.join(''.join(segments).split())
            assert body.count('长段落应连续分页，所有文字应保持完整。') == record['repetitions'], (name, body.count('长段落应连续分页，所有文字应保持完整。'))
            assert compact.count('很长的学校名称和项目名称需要完整换行并保留所有内容。') == 5, name
        paragraphs = []
        summary = next(section for section in resume['sections'] if section['kind'] == 'summary')
        region = next(field for field in fields if field['sectionId'] == summary['id'])
        for expected in record.get('paragraphs') or []:
            match = pdf.pages[region['page'] - 1].search(expected['text'], regex=False)[0]
            x, width = region['columnX'], region['columnWidth']
            if expected['alignment'] == 'left':
                error = match['x0'] - x - expected.get('inset', 0)
            elif expected['alignment'] == 'right':
                error = match['x1'] - x - width + expected.get('inset', 0)
            else:
                error = (match['x0'] + match['x1']) / 2 - x - width / 2
            assert abs(error) < .7, f'{name}: {expected["text"]} offset {error:.3f}pt'
            paragraphs.append({'text': expected['text'], 'alignment': expected['alignment'], 'errorPt': round(error, 3)})
        for field in fields:
            assert field['x'] >= field['columnX'] - .4 and field['x'] + field['width'] <= field['columnX'] + field['columnWidth'] + .4, f'{name}: field escaped its column'
        report.append({'id': name, 'pages': len(pdf.pages), 'outsideA4': outside, 'paragraphs': paragraphs, 'content': 'passed'})
(out / 'content-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'cases': len(report), 'pages': sum(r['pages'] for r in report), 'paragraphChecks': sum(len(r['paragraphs']) for r in report), 'outsideA4': 0, 'passed': True}, ensure_ascii=True))
