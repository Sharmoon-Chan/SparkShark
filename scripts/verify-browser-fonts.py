"""Verify all prepared browser shards without regenerating fonts."""
from pathlib import Path
import gzip
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'font-python'))
from fontTools.ttLib import TTFont

fonts = ROOT / 'public' / 'fonts'
manifest = json.loads((fonts / 'browser-manifest.json').read_text(encoding='utf-8'))
originals = json.loads((fonts / 'manifest.json').read_text(encoding='utf-8'))
reports = []
for family_id, family in manifest['families'].items():
    chunk_points = {chunk['id']: {p for a, b in chunk['ranges'] for p in range(a, b + 1)} for chunk in family['chunks']}
    for face in family['faces']:
        original = next(item for item in originals['families'][family_id]['files'] if item['weight'] == face['weight'] and item['style'] == face['style'])
        assert face['sourceSha256'] == original['sha256']
        source = TTFont(fonts / original['file'])
        expected = set(source.getBestCmap()); source.close()
        found = set(); total_bytes = 0
        for part in face['parts']:
            path = fonts / part['file']; data = path.read_bytes()
            assert len(data) == part['bytes']
            assert hashlib.sha256(data).hexdigest() == part['sha256']
            shard = TTFont(path); points = set(shard.getBestCmap()); shard.close()
            assert points == chunk_points[part['chunk']] & expected
            assert not found & points
            found.update(points); total_bytes += len(data)
        assert found == expected
        reports.append({'family': family_id, 'weight': face['weight'], 'style': face['style'], 'glyphCodepoints': len(found), 'files': len(face['parts']), 'bytes': total_bytes})
    print(f"Verified {family_id}", flush=True)
output = ROOT / 'output' / 'browser-font-review'; output.mkdir(parents=True, exist_ok=True)
(output / 'verification.json').write_text(json.dumps({'faces': reports, 'allHashesAndCoverageMatch': True}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'faces': len(reports), 'files': sum(item['files'] for item in reports), 'allHashesAndCoverageMatch': True}))
