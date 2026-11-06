type Anchor = { group: string; column: string; sectionId?: string; ratio?: number; sourceY: number; screenY: number };
const clips = (document: Document) => [...document.querySelectorAll<HTMLElement>('#preview-pages .preview-column-clip')];

export function capturePreviewAnchor(document: Document, viewportY: number): Anchor | null {
  if (viewportY < 20) return null;
  const candidates = clips(document).filter(clip => clip.getBoundingClientRect().bottom >= viewportY);
  const clip = candidates.sort((a, b) => Math.max(a.getBoundingClientRect().top, viewportY) - Math.max(b.getBoundingClientRect().top, viewportY))[0];
  if (!clip) return null;
  const box = clip.getBoundingClientRect();
  const visibleY = Math.max(viewportY, box.top);
  const sourceY = Number(clip.dataset.sourceStart) + visibleY - box.top;
  const section = [...clip.querySelectorAll<HTMLElement>('[data-section-id]')].find(item => Number(item.dataset.sourceTop) <= sourceY && Number(item.dataset.sourceBottom) >= sourceY);
  const top = Number(section?.dataset.sourceTop), bottom = Number(section?.dataset.sourceBottom);
  return { group: clip.dataset.logicalGroup!, column: clip.dataset.previewColumn!, sourceY, screenY: visibleY - viewportY,
    ...(section && bottom > top ? { sectionId: section.dataset.sectionId, ratio: (sourceY - top) / (bottom - top) } : {}) };
}

export function restorePreviewAnchor(document: Document, anchor: Anchor): number | null {
  let position = anchor.sourceY;
  const sameColumn = clips(document).filter(clip => clip.dataset.logicalGroup === anchor.group && clip.dataset.previewColumn === anchor.column);
  if (anchor.sectionId) {
    const section = sameColumn.flatMap(clip => [...clip.querySelectorAll<HTMLElement>('[data-section-id]')]).find(item => item.dataset.sectionId === anchor.sectionId);
    if (section) position = Number(section.dataset.sourceTop) + (anchor.ratio ?? 0) * (Number(section.dataset.sourceBottom) - Number(section.dataset.sourceTop));
  }
  const clip = sameColumn.find(item => Number(item.dataset.sourceStart) <= position && Number(item.dataset.sourceEnd) >= position) ?? sameColumn.at(-1);
  if (!clip) return null;
  return clip.getBoundingClientRect().top + Math.max(0, Math.min(position - Number(clip.dataset.sourceStart), clip.getBoundingClientRect().height)) - anchor.screenY;
}
