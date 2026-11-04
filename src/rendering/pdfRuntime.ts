import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
export function openPdf(bytes: Uint8Array) {
  const base = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.origin).href;
  return pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
}
export { pdfjs };
