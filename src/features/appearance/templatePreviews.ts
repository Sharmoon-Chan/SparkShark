// These build-time assets never depend on resume content or the PDF renderer.
const assets = import.meta.glob<string>('./template-previews/*.{svg,webp,png}', { eager: true, query: '?url', import: 'default' });
export const TEMPLATE_PREVIEWS: Record<string, string> = Object.fromEntries(Object.entries(assets).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''), url]));
export const templatePreviewFor = (id: string): string | undefined => TEMPLATE_PREVIEWS[id] ?? TEMPLATE_PREVIEWS.clean;
