import { useMemo, type RefObject } from 'react';
import type { PreviewFieldDrop, PreviewFieldRegion } from '../../domain/types';
import { PreviewFieldDragProvider, PreviewFieldLayer } from './PreviewFieldLayer';
import { HTML_PREVIEW_MIN_HEIGHT, HTML_PREVIEW_WIDTH } from './htmlPreviewDocument';
import { PAGE_GAP } from './domPagination';
import type { PreviewAlignmentActions } from './previewAlignment';

export interface HtmlFieldOverlayProps { fields: readonly PreviewFieldRegion[]; enabled: boolean; zoom: number; scrollContainer: RefObject<HTMLDivElement | null>; onDrop: (drop: PreviewFieldDrop) => void; alignment?: PreviewAlignmentActions; toolbarTarget?: HTMLElement | null }
export function HtmlFieldOverlay({ fields, enabled, zoom, scrollContainer, onDrop, alignment, toolbarTarget }: HtmlFieldOverlayProps) {
  const groups = useMemo(() => {
    const pages = new Map<number, PreviewFieldRegion[]>();
    for (const field of fields) { const list = pages.get(field.page) ?? []; list.push(field); pages.set(field.page, list); }
    return [...pages];
  }, [fields]);
  return <PreviewFieldDragProvider fields={fields} enabled={enabled} scale={zoom / .75} scrollContainer={scrollContainer} onDrop={onDrop} alignment={alignment} toolbarTarget={toolbarTarget}>
    <div className="html-field-overlay" aria-label="即时预览字段布局">{groups.map(([page, pageFields]) => <div key={page} className="html-field-page" style={{ top: (page - 1) * (HTML_PREVIEW_MIN_HEIGHT + PAGE_GAP) * zoom, width: HTML_PREVIEW_WIDTH * zoom, height: HTML_PREVIEW_MIN_HEIGHT * zoom }}><PreviewFieldLayer fields={pageFields} page={page} scale={zoom / .75} /></div>)}</div>
  </PreviewFieldDragProvider>;
}
