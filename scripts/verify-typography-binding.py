"""Verify PDF font family and exact text sizes for the synthetic binding cases."""
import json
from pathlib import Path
import pdfplumber

root = Path(__file__).resolve().parents[1] / 'output' / 'typography-binding'
expected = {
    'legacy-13': [12.5, 10, 12, 13 * 18 / 14, 13],
    'linked-16': [12.5 * 16 / 13, 10 * 16 / 13, 12 * 16 / 13, 16 * 18 / 14, 16],
    'unified-13': [13 * 18 / 14, 13, 13, 13 * 18 / 14, 13],
    'unified-16': [16 * 18 / 14, 16, 16, 16 * 18 / 14, 16],
}
tokens = ['BindProjectTitle', 'BindProjectIntro', 'BindProjectBody', 'BindSkillTitle', 'BindSkillBody']
results = []
for name, sizes in expected.items():
    with pdfplumber.open(root / (name + '.pdf')) as pdf:
        row = {'case': name, 'fields': []}
        for token, size in zip(tokens, sizes):
            matches = [match for page in pdf.pages for match in page.search(token, regex=False)]
            assert len(matches) == 1, (name, token, 'missing or duplicated')
            chars = matches[0]['chars']
            assert all(abs(char['size'] - size * .75) < .01 for char in chars), (name, token, size)
            assert all('SourceHanSansSC' in char['fontname'] for char in chars), (name, token, 'wrong family')
            if token.endswith('Title'):
                assert all('Bold' in char['fontname'] for char in chars), (name, token, 'missing bold')
            row['fields'].append({'token': token, 'sizePx': round(size, 4), 'fonts': sorted(set(char['fontname'] for char in chars))})
        assert all(-.5 <= char['x0'] <= char['x1'] <= page.width + .5 and -.5 <= char['top'] <= char['bottom'] <= page.height + .5 for page in pdf.pages for char in page.chars)
        results.append(row)
(root / 'pdf-verification.json').write_text(json.dumps({'passed': True, 'results': results}, indent=2), encoding='utf-8')
print(json.dumps({'cases': len(results), 'fields': sum(len(row['fields']) for row in results), 'passed': True}))
