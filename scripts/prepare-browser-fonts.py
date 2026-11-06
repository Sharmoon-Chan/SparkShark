"""Build demand-loaded WOFF2 faces for the browser preview.

PDF fonts and the existing delivery manifest are not modified. Every source cmap
character belongs to one disjoint shard; glyph outlines, horizontal metrics and
OpenType layout closure are retained by fontTools. Run with Python 3.10+,
fontTools and Brotli installed, or use the bundled Codex Python runtime.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'font-python'))
from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = ROOT / 'public' / 'fonts'
TARGET = FONTS / 'browser'
RECIPE = 'browser-woff2-v1-common-gb2312-level1-tail1024-layout-all'


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def ranges(points: set[int]) -> list[list[int]]:
    output: list[list[int]] = []
    for point in sorted(points):
        if output and point == output[-1][1] + 1:
            output[-1][1] = point
        else:
            output.append([point, point])
    return output


def common_chinese() -> set[int]:
    # A reproducible standard character set, not user resume text or a remote
    # frequency corpus. Common Chinese resumes typically need this one shard
    # plus basic punctuation, instead of dozens of Unicode-block requests.
    points: set[int] = set()
    for first in range(0xB0, 0xD8):
        for second in range(0xA1, 0xFF):
            try:
                points.add(ord(bytes([first, second]).decode('gb2312')))
            except UnicodeDecodeError:
                pass
    return points


def split_points(points: set[int]) -> list[tuple[str, set[int]]]:
    base = {point for point in points if point < 0x400 or 0x2000 <= point <= 0x206F or 0x3000 <= point <= 0x303F or 0xFF00 <= point <= 0xFFEF}
    common = (points & common_chinese()) - base
    remaining = sorted(points - base - common)
    result = [('base', base), ('common', common)]
    result += [(f'extended-{index // 1024:03}', set(remaining[index:index + 1024])) for index in range(0, len(remaining), 1024)]
    result = [(name, values) for name, values in result if values]
    flattened = [point for _, values in result for point in values]
    if len(flattened) != len(set(flattened)) or set(flattened) != points:
        raise ValueError('Browser font shards do not exactly cover the source cmap')
    return result


def build_face(job: dict) -> dict:
    source = FONTS / job['sourceFile']
    source_bytes = source.read_bytes()
    if sha256(source_bytes) != job['sourceSha256']:
        raise ValueError('Source TTF checksum mismatch: ' + job['sourceFile'])
    # Load/instantiate independently per shard to avoid fontTools' in-place
    # subset mutations leaking into later shards. A process owns one face.
    parts = []
    for name, sorted_points in job['shards']:
        points = set(sorted_points)
        recipe_key = sha256((RECIPE + ':' + job['sourceSha256'] + ':' + ','.join(map(str, sorted_points))).encode())[:16]
        target = TARGET / f"{Path(job['sourceFile']).stem}.{name}.{recipe_key}.woff2"
        if target.exists():
            packed = target.read_bytes()
            verified = TTFont(target)
            if set(verified.getBestCmap()) != points:
                raise ValueError('Cached shard cmap mismatch: ' + target.name)
            verified.close()
        else:
            font = TTFont(source)
            options = subset.Options()
            options.layout_features = ['*']
            options.name_IDs = ['*']
            options.name_legacy = True
            options.name_languages = ['*']
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=points)
            subsetter.subset(font)
            if set(font.getBestCmap()) != points:
                raise ValueError('Subset lost characters: ' + target.name)
            font.flavor = 'woff2'
            temporary = target.with_suffix('.tmp.woff2')
            font.save(temporary)
            font.close()
            verified = TTFont(temporary)
            if set(verified.getBestCmap()) != points:
                raise ValueError('Encoded shard cmap mismatch: ' + target.name)
            verified.close()
            temporary.replace(target)
            packed = target.read_bytes()
        parts.append({'chunk': name, 'file': 'browser/' + target.name, 'sha256': sha256(packed), 'bytes': len(packed)})
    return {'weight': job['weight'], 'style': job['style'], 'sourceSha256': job['sourceSha256'], 'parts': parts}


def main(workers: int, selected: list[str] | None) -> None:
    start = time.perf_counter()
    source_manifest = json.loads((FONTS / 'manifest.json').read_text(encoding='utf-8'))
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest_path = FONTS / 'browser-manifest.json'
    result = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'families': {}}
    result.update(version=1, preparedOn=date.today().isoformat(), recipe=RECIPE)
    selected_ids = selected or list(source_manifest['families'])
    if any(key not in source_manifest['families'] for key in selected_ids):
        raise ValueError('Unknown selected font family')
    jobs = []
    for family_id in selected_ids:
        family = source_manifest['families'][family_id]
        # The union of all face cmaps, not only the legacy PDF manifest's shared
        # coverage, ensures browser delivery preserves each source character.
        union: set[int] = set()
        face_points = {}
        for entry in family['files']:
            font = TTFont(FONTS / entry['file'])
            face_points[entry['file']] = set(font.getBestCmap())
            union.update(face_points[entry['file']])
            font.close()
        shards = split_points(union)
        result['families'][family_id] = {
            'family': 'Preview' + family['family'],
            'license': family['license'],
            'coverage': ranges(union),
            'chunks': [{'id': name, 'ranges': ranges(points)} for name, points in shards],
            'faces': [],
        }
        for entry in family['files']:
            jobs.append({'familyId': family_id, 'sourceFile': entry['file'], 'sourceSha256': entry['sha256'],
                         'weight': entry['weight'], 'style': entry['style'],
                         'shards': [(name, sorted(points & face_points[entry['file']])) for name, points in shards if points & face_points[entry['file']]]})
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(build_face, job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            face = future.result()
            result['families'][job['familyId']]['faces'].append(face)
            print(f"Prepared {job['sourceFile']}: {len(face['parts'])} shards / {sum(part['bytes'] for part in face['parts']):,} bytes", flush=True)
    for family in result['families'].values():
        family['faces'].sort(key=lambda face: (face['weight'], face['style']))
    # Publish only a complete manifest. Asset files have recipe/content-addressed
    # names and remain safe if preparation is interrupted or resumed.
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    files = [part for family in result['families'].values() for face in family['faces'] for part in face['parts']]
    report = {'version': result['version'], 'recipe': RECIPE, 'families': len(result['families']),
              'faces': sum(len(family['faces']) for family in result['families'].values()), 'files': len(files),
              'totalBytes': sum(part['bytes'] for part in files), 'largestFileBytes': max(part['bytes'] for part in files),
              'elapsedSeconds': round(time.perf_counter() - start, 2), 'coverage': {key: sum(end - begin + 1 for begin, end in family['coverage']) for key, family in result['families'].items()}}
    output = ROOT / 'output' / 'browser-font-review'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'asset-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--family', action='append')
    args = parser.parse_args()
    main(max(1, min(args.workers, 12)), args.family)
