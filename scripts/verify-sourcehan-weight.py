"""Verify native Source Han Regular/Bold outlines and optional repair isolation."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'font-python'))
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before', type=Path, help='Manifest captured before the weight repair')
args = parser.parse_args()
fonts = ROOT / 'public/fonts'
manifest = json.loads((fonts / 'manifest.json').read_text(encoding='utf-8'))
family = manifest['families']['source-han-sans-sc']
assert family['sourceWeights'] == {'400': 400, '700': 700}
digest = lambda data: hashlib.sha256(data).hexdigest()
reference_files = {(file['weight'], file['style']): file for file in manifest['families']['noto-sans-sc']['files']}
common = None
results = []
for file in family['files']:
    data = (fonts / file['file']).read_bytes()
    assert digest(data) == file['sha256']
    packed = (fonts / file['compressed']['file']).read_bytes()
    assert digest(packed) == file['compressed']['sha256']
    assert gzip.decompress(packed) == data
    current = TTFont(fonts / file['file'])
    reference = TTFont(fonts / reference_files[(file['weight'], file['style'])]['file'])
    assert current['OS/2'].usWeightClass == file['weight']
    assert current.getGlyphOrder() == reference.getGlyphOrder()
    # Metadata weight alone is insufficient: the former Medium was labelled 400.
    # Verify the complete outline and advance tables against native Noto 400/700.
    for table in ('glyf', 'hmtx'):
        assert current.getTableData(table) == reference.getTableData(table), (file['file'], table)
    if file['style'] == 'italic':
        assert current['post'].italicAngle < 0
    coverage = set(current.getBestCmap())
    common = coverage if common is None else common.intersection(coverage)
    results.append({'file': file['file'], 'bytes': len(data), 'sha256': file['sha256'],
                    'nativeWeight': file['weight'], 'style': file['style'],
                    'nativeOutlinesAndAdvancesMatch': True, 'compressedRoundTrip': True})
    current.close()
    reference.close()
declared = {point for start, end in family['coverage'] for point in range(start, end + 1)}
assert common == declared
report = {'sourceWeights': family['sourceWeights'], 'commonCodepoints': len(common), 'files': results}
if args.before:
    before = json.loads(args.before.read_text(encoding='utf-8'))
    for key, previous in before['families'].items():
        if key != 'source-han-sans-sc':
            assert previous == manifest['families'][key], key
    previous = before['families']['source-han-sans-sc']
    assert previous['coverage'] == family['coverage']
    for file in family['files']:
        if file['weight'] == 700:
            assert file == next(item for item in previous['files'] if item['file'] == file['file'])
    report.update(beforeSourceWeights=previous['sourceWeights'], otherFamiliesUnchanged=True, boldAssetsUnchanged=True, coverageUnchanged=True)
output = ROOT / 'output/sourcehan-weight-review'
output.mkdir(parents=True, exist_ok=True)
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
