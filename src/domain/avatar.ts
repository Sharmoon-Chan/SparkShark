import type { Appearance } from './types';

export type AvatarCrop = NonNullable<Appearance['avatar']['crop']>;
export interface AvatarDimensions { width: number; height: number }

/** Straight frames preserve the image and any saved crop. */
export function avatarFrame(avatar: Appearance['avatar']): Appearance['avatar'] {
  const oldCircle = Math.abs(avatar.aspectRatio - 1) < .001 && avatar.radiusPx > 0;
  return { ...avatar, aspectRatio: oldCircle ? 3 / 4 : avatar.aspectRatio, radiusPx: 0 };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A crop keeps its previous centre when changing ratio or zoom. */
export function avatarCropAtZoom(dimensions: AvatarDimensions, aspect: number, zoom = 1, previous?: AvatarCrop): AvatarCrop {
  const ratio = dimensions.width / dimensions.height;
  const safeZoom = Math.max(1, zoom);
  const width = Math.min(1, aspect / ratio) / safeZoom, height = Math.min(1, ratio / aspect) / safeZoom;
  const centerX = previous ? previous.x + previous.width / 2 : .5;
  const centerY = previous ? previous.y + previous.height / 2 : .5;
  return { x: clamp(centerX - width / 2, 0, 1 - width), y: clamp(centerY - height / 2, 0, 1 - height), width, height };
}

export function avatarCropZoom(dimensions: AvatarDimensions, aspect: number, crop: AvatarCrop): number {
  const base = avatarCropAtZoom(dimensions, aspect);
  return Math.max(1, base.width / crop.width, base.height / crop.height);
}

/** Display a stored crop in any rectangular frame with a uniform image scale. */
export function avatarCropStyle(dimensions: AvatarDimensions, crop: AvatarCrop, frameWidth: number, aspect: number) {
  const frameHeight = frameWidth / aspect;
  const scale = Math.max(frameWidth / (dimensions.width * crop.width), frameHeight / (dimensions.height * crop.height));
  const width = dimensions.width * scale, height = dimensions.height * scale;
  return { width, height, left: (frameWidth - width * crop.width) / 2 - crop.x * width, top: (frameHeight - height * crop.height) / 2 - crop.y * height };
}
