"""Prepare self-hosted static CJK fonts from their upstream SIL OFL sources.

Existing verified outputs are kept. Use --family ID to prepare one family,
or --force to rebuild all selected families from cached upstream sources.
"""
from __future__ import annotations

import copy
import argparse
import hashlib
import json
import math
from datetime import date
from pathlib import Path
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'font-python'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen

OUT = ROOT / 'public' / 'fonts'
CACHE = ROOT / '.tools' / 'font-sources'
GOOGLE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
PLEX = 'https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-sc/'
FAMILIES = [
    {'id': 'noto-sans-sc', 'prefix': 'sans', 'family': 'MyResumeSansSC',
     'variable': GOOGLE + 'notosanssc/NotoSansSC%5Bwght%5D.ttf', 'license': GOOGLE + 'notosanssc/OFL.txt'},
    {'id': 'noto-serif-sc', 'prefix': 'serif', 'family': 'MyResumeSerifSC',
     'variable': GOOGLE + 'notoserifsc/NotoSerifSC%5Bwght%5D.ttf', 'license': GOOGLE + 'notoserifsc/OFL.txt'},
    {'id': 'lxgw-wenkai', 'prefix': 'wenkai', 'family': 'MyResumeWenKaiTC',
     'static': {400: GOOGLE + 'lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf', 700: GOOGLE + 'lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf'},
     'license': GOOGLE + 'lxgwwenkaitc/OFL.txt'},
    {'id': 'ibm-plex-sans-sc', 'prefix': 'plex', 'family': 'MyResumePlexSansSC',
     'static': {400: PLEX + 'fonts/complete/ttf/unhinted/IBMPlexSansSC-Regular.ttf', 700: PLEX + 'fonts/complete/ttf/unhinted/IBMPlexSansSC-Bold.ttf'},
     'license': PLEX + 'LICENSE.txt'},
    {'id': 'chiron-round-tc', 'prefix': 'round', 'family': 'MyResumeRoundTC',
     'variable': GOOGLE + 'chirongoroundtc/ChironGoRoundTC%5Bwght%5D.ttf', 'license': GOOGLE + 'chirongoroundtc/OFL.txt'},
    # TalenCat's 思源黑体 is Noto Sans SC, from the same Source Han / Noto project.
    # Map the native Medium outlines to the regular face for a more solid body.
    {'id': 'source-han-sans-sc', 'prefix': 'sourcehan', 'family': 'MyResumeSourceHanSansSC',
     'variable': GOOGLE + 'notosanssc/NotoSansSC%5Bwght%5D.ttf', 'license': GOOGLE + 'notosanssc/OFL.txt',
     'instance_weights': {400: 500, 700: 700}},
]

def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 100:
        return
    print('Downloading ' + path.name, flush=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'MyResume font preparation'})
    temporary = path.with_suffix(path.suffix + '.download')
    with urllib.request.urlopen(request, timeout=60) as response:
        temporary.write_bytes(response.read())
    temporary.replace(path)

def rename_font(font: TTFont, family: str, weight: int, oblique: bool) -> None:
    style = ('Bold' if weight == 700 else '') + ('Oblique' if oblique else '')
    style = style or 'Regular'
    names = {1: family, 2: style, 3: family + '-' + style, 4: family + ' ' + style,
             6: family + '-' + style, 16: family, 17: style}
    for name in font['name'].names:
        if name.nameID in names:
            name.string = names[name.nameID].encode('utf-16be' if name.isUnicode() else 'ascii')
    font['OS/2'].usWeightClass = weight
    font['head'].macStyle = (1 if weight == 700 else 0) | (2 if oblique else 0)
    if oblique:
        font['OS/2'].fsSelection |= 1 | (1 << 9)
        font['OS/2'].fsSelection &= ~(1 << 6)
        font['post'].italicAngle = -11.3

def make_oblique(source: TTFont) -> TTFont:
    result = copy.deepcopy(source)
    glyphs = source.getGlyphSet()
    for name in source.getGlyphOrder():
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (1, 0, .2, 1, 0, 0)))
        glyph = pen.glyph()
        result['glyf'][name] = glyph
    for name in result.getGlyphOrder():
        glyph = result['glyf'][name]
        glyph.recalcBounds(result['glyf'])
        advance, bearing = source['hmtx'][name]
        if hasattr(glyph, 'xMax'):
            result['hmtx'][name] = (max(advance, math.ceil(glyph.xMax + 8)), glyph.xMin)
        else:
            result['hmtx'][name] = (advance, bearing)
    return result

def distinct_bullet_glyph(font: TTFont) -> bool:
    """Keep bullet/middle-dot Unicode identities distinct in PDF subsets."""
    cmap = font.getBestCmap()
    bullet, middle_dot = cmap.get(0x2022), cmap.get(0x00B7)
    if not bullet or bullet != middle_dot:
        return False
    order = list(font.getGlyphOrder())
    separate = bullet + '.bullet'
    while separate in order:
        separate += '_'
    font['glyf'][separate] = copy.deepcopy(font['glyf'][bullet])
    font['hmtx'][separate] = font['hmtx'][bullet]
    if 'vmtx' in font:
        font['vmtx'][separate] = font['vmtx'][bullet]
    font.setGlyphOrder(order + [separate])
    font['glyf'].setGlyphOrder(order + [separate])
    for table in font['cmap'].tables:
        if table.isUnicode() and 0x2022 in getattr(table, 'cmap', {}):
            table.cmap[0x2022] = separate
    return True

def repair_prepared_fonts() -> None:
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for family in manifest['families'].values():
        for file in family['files']:
            target = OUT / file['file']
            font = TTFont(target)
            if distinct_bullet_glyph(font):
                font.save(target)
                file['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
                print('Repaired ' + file['file'], flush=True)
    manifest['version'] = 5
    manifest['preparedOn'] = date.today().isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    write_preview_css(manifest)

def ranges(points: set[int]) -> list[list[int]]:
    output = []
    for point in sorted(points):
        if output and point == output[-1][1] + 1:
            output[-1][1] = point
        else:
            output.append([point, point])
    return output

def prepared(entry: dict | None) -> bool:
    return bool(entry and len(entry['files']) == 4 and (OUT / entry['license']).is_file()
                and all((OUT / item['file']).is_file()
                        and hashlib.sha256((OUT / item['file']).read_bytes()).hexdigest() == item['sha256']
                        for item in entry['files']))


def write_preview_css(manifest: dict) -> None:
    lines = ['/* Generated by scripts/setup-fonts.py. Self-hosted faces load only when used. */']
    for family in manifest['families'].values():
        for file in family['files']:
            src = f"/fonts/{file['file']}?v={file['sha256'][:16]}"
            lines.append(f"@font-face{{font-family:{family['family']};src:url('{src}') format('truetype');font-weight:{file['weight']};font-style:{file['style']};font-display:swap}}")
    (ROOT / 'src' / 'features' / 'appearance' / 'fonts.css').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main(selected: list[str] | None = None, force: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.is_file() else {'families': {}}
    manifest.update(version=6, preparedOn=date.today().isoformat())
    for spec in FAMILIES:
        key, prefix, renamed = spec['id'], spec['prefix'], spec['family']
        if selected and key not in selected:
            continue
        if not force and prepared(manifest['families'].get(key)):
            print('Already prepared ' + key, flush=True)
            continue
        sources = {400: spec['variable'], 700: spec['variable']} if 'variable' in spec else spec['static']
        source_paths = {weight: CACHE / (prefix + ('-variable' if 'variable' in spec else f'-source-{weight}') + '.ttf') for weight in (400, 700)}
        downloads = {(url, source_paths[weight]) for weight, url in sources.items()}
        downloads.add((spec['license'], OUT / (prefix + '-OFL.txt')))
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(download, url, path) for url, path in downloads]
            for future in futures:
                future.result()
        files = []
        points = None
        for weight in (400, 700):
            print(f'Preparing {prefix} {weight}', flush=True)
            source = TTFont(source_paths[weight])
            source_weight = spec.get('instance_weights', {}).get(weight, weight)
            regular = instantiateVariableFont(source, {'wght': source_weight}, inplace=False) if 'fvar' in source else copy.deepcopy(source)
            distinct_bullet_glyph(regular)
            coverage = set(regular.getBestCmap())
            points = coverage if points is None else points.intersection(coverage)
            for oblique in (False, True):
                filename = f'{prefix}-{weight}' + ('-oblique' if oblique else '') + '.ttf'
                target = OUT / filename
                print('Writing ' + filename, flush=True)
                font = make_oblique(regular) if oblique else copy.deepcopy(regular)
                rename_font(font, renamed, weight, oblique)
                font.flavor = None
                font.save(target)
                files.append({'file': filename, 'weight': weight,
                              'style': 'italic' if oblique else 'normal',
                              'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
            source.close()
        manifest['families'][key] = {'family': renamed, 'files': files,
            'coverage': ranges(points), 'source': sources[400], 'sources': {str(weight): url for weight, url in sources.items()},
            'license': prefix + '-OFL.txt'}
        if 'instance_weights' in spec:
            manifest['families'][key]['sourceWeights'] = {str(weight): value for weight, value in spec['instance_weights'].items()}
        # Publish each complete family so interrupted runs remain resumable.
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    write_preview_css(manifest)
    print('Static fonts ready.', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family', action='append', choices=[spec['id'] for spec in FAMILIES])
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--repair-bullet', action='store_true')
    args = parser.parse_args()
    if args.repair_bullet:
        repair_prepared_fonts()
    else:
        main(args.family, args.force)
