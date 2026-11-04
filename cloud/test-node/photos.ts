import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { BackupAsset } from '../../src/domain/types';

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

/** A valid 1x1 PNG padded with an ancillary text chunk to the exact requested size. */
export function pngAsset(targetBytes = 0, marker = 65): BackupAsset {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const prefix = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  ]);
  const end = chunk('IEND', Buffer.alloc(0));
  const keyword = Buffer.from('Comment\0');
  const padding = targetBytes ? targetBytes - prefix.length - end.length - 12 - keyword.length : 0;
  if (targetBytes && padding < 0) throw new Error('Requested PNG size is too small');
  const bytes = Buffer.concat([prefix, ...(targetBytes ? [chunk('tEXt', Buffer.concat([keyword, Buffer.alloc(padding, marker)]))] : []), end]);
  return { id: `synthetic-image-${marker}`, mime: 'image/png', width: 1, height: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'), dataBase64: bytes.toString('base64') };
}
