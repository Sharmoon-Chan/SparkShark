import type { Asset, PreparedAsset, Resume } from '../domain/types';

export async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob); const image = new window.Image();
  try { image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
}
export async function normalizePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 照片');
  if (file.size > 5 * 1024 * 1024) throw new Error('照片需要小于 5 MB');
  const image = await imageFromBlob(file);
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('照片像素过大，请先缩小后上传');
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('照片转换失败')), file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', .95));
  return { blob, width: canvas.width, height: canvas.height };
}
export async function prepareAssets(resume: Resume, assets: Record<string, Asset>): Promise<Record<string, PreparedAsset>> {
  const output: Record<string, PreparedAsset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    const crop = resume.appearance.avatar.crop;
    if (!crop) { output[id] = { data: new Uint8Array(await asset.blob.arrayBuffer()), mime: asset.mime, width: asset.width, height: asset.height }; continue; }
    const image = await imageFromBlob(asset.blob); const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * crop.width)); canvas.height = Math.max(1, Math.round(image.naturalHeight * crop.height));
    canvas.getContext('2d')!.drawImage(image, crop.x * image.naturalWidth, crop.y * image.naturalHeight, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('照片裁剪失败')), 'image/png'));
    output[id] = { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: canvas.width, height: canvas.height };
  }
  return output;
}
