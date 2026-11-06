"""Encode the generated synthetic template pages; requires Pillow with WebP."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw

source, destination = (Path(value).resolve() for value in sys.argv[1:3])
catalog = json.loads((source / 'catalog.json').read_text(encoding='utf-8'))
report = []
sheet = Image.new('RGB', (4 * 208, 4 * 322), '#e9eee9')
draw = ImageDraw.Draw(sheet)
for index, template in enumerate(catalog):
    with Image.open(source / (template['id'] + '.png')) as image:
        image = image.convert('RGB')
        target = destination / (template['id'] + '.webp')
        image.save(target, 'WEBP', quality=82, method=6)
        data = target.read_bytes()
        report.append({'id': template['id'], 'file': target.name, 'width': image.width,
                       'height': image.height, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        thumb = image.copy()
        thumb.thumbnail((192, 280), Image.Resampling.LANCZOS)
        x, y = (index % 4) * 208 + 8, (index // 4) * 322 + 8
        sheet.paste(thumb, (x, y))
        draw.text((x, y + 286), template['id'], fill='#27382f')
total = sum(item['bytes'] for item in report)
if total > 500 * 1024:
    raise RuntimeError('Static preview catalog exceeds 500 KiB: ' + str(total))
sheet.save(source / 'contact-sheet.png')
(source / 'report.json').write_text(json.dumps({'count': len(report), 'totalBytes': total, 'assets': report}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'count': len(report), 'totalBytes': total, 'format': 'WebP', 'width': 480}))
