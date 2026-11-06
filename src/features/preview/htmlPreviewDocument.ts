import type { PreparedAsset, Resume } from '../../domain/types';
import { renderResumeHtml } from '../../rendering/html';

export const HTML_PREVIEW_WIDTH = 794;
export const HTML_PREVIEW_MIN_HEIGHT = 1123;
const PLACEHOLDER_PHOTO = 'data:image/png;base64,AQ==';

// Loaded once: all subsequent updates replace only our escaped content/styles.
// Scripts and remote content remain forbidden. Fonts are supplied by the
// application through verified same-origin bytes, not by resume HTML.
export const HTML_PREVIEW_SHELL = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'self' blob:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>简历预览</title><style id="preview-theme"></style><style>
html,body{margin:0;width:794px;background:transparent;overflow:hidden}
[data-preview-source]{position:absolute!important;left:0!important;top:0!important;width:794px!important;visibility:hidden!important;pointer-events:none!important}
[data-preview-source] .layout-page{min-height:0!important;box-shadow:none!important}
#preview-pages{position:relative;width:794px;margin:0}
#preview-reading{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:normal!important;pointer-events:none}
</style><style id="preview-font"></style></head><body><main id="preview-source" data-preview-source aria-hidden="true" inert></main><main id="preview-pages" aria-hidden="true"></main><main id="preview-reading" aria-label="简历内容"></main></body></html>`;

/** Local font stacks only: an interactive preview must not wait for a font download. */
export function previewSystemFont(fontId: string): string {
  if (fontId === 'noto-serif-sc') return '"Songti SC","SimSun","Noto Serif CJK SC",serif';
  if (fontId === 'lxgw-wenkai') return '"KaiTi","Kaiti SC","STKaiti",serif';
  return '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif';
}

export function previewPhotoDataUrl(asset: PreparedAsset): string {
  let binary = '';
  for (let i = 0; i < asset.data.length; i += 32768) binary += String.fromCharCode(...asset.data.subarray(i, i + 32768));
  return `data:${asset.mime};base64,${btoa(binary)}`;
}

/** Reuse the export renderer without changing the standalone HTML export. */
export function renderHtmlPreview(resume: Resume, photoDataUrl?: string): string {
  if (photoDataUrl && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]*={0,2}$/.test(photoDataUrl)) throw new Error('预览照片格式无效');
  const avatarId = resume.basics.avatarAssetId;
  // The photo has already been encoded when its source/crop changed. Use a tiny
  // sentinel so typing in a text field does not re-encode the entire image.
  const assets: Record<string, PreparedAsset> = photoDataUrl && avatarId
    ? { [avatarId]: { data: new Uint8Array([1]), mime: 'image/png', width: 1, height: 1 } }
    : {};
  let html = renderResumeHtml(resume, assets);
  if (photoDataUrl) html = html.replace(`src="${PLACEHOLDER_PHOTO}"`, `src="${photoDataUrl}"`);
  const css = `
html,body{background:transparent;height:auto;min-height:0;overflow:hidden}
body{font-family:${previewSystemFont(resume.appearance.fontFamilyId)};font-weight:400;font-style:normal}
.resume{width:${HTML_PREVIEW_WIDTH}px;max-width:none;margin:0;display:flow-root}
.layout-page{min-height:${HTML_PREVIEW_MIN_HEIGHT}px;margin:0 0 24px;box-shadow:none}
.layout-page:last-child{margin-bottom:0}
.resume-section{position:relative}
.resume-section[data-preview-interactive]{cursor:pointer;outline:1px solid transparent;outline-offset:4px;border-radius:2px}
.resume-section[data-preview-interactive]:hover,.resume-section[data-preview-interactive]:focus-visible,.resume-section[data-keyboard-focus]{outline-color:color-mix(in srgb,var(--theme) 65%,white);background:color-mix(in srgb,var(--theme) 3%,white)}
.resume-section[data-preview-interactive]:focus{scroll-margin-block:20px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
  // Explicitly forbid font/network loads, even if the shared renderer later
  // gains additional presentation options. The iframe also disallows scripts.
  html = html.replace("default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'");
  return html.replace('</head>', `<style data-quick-preview>${css}</style></head>`);
}
