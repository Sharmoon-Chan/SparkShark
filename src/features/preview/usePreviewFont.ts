import { useEffect } from 'react';
import { browserFontFamily, ensureBrowserFonts } from './browserFonts';
import { previewSystemFont } from './htmlPreviewDocument';

/** Share the paper's font and delivery path with size samples outside the iframe. */
export function usePreviewFont(fontId: string, text: string, enabled = true, italic = false): string {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void ensureBrowserFonts(document, fontId, text, { signal: controller.signal, italic }).catch(() => undefined);
    return () => controller.abort();
  }, [fontId, text, enabled, italic]);
  return `"${browserFontFamily(fontId)}",${previewSystemFont(fontId)}`;
}
