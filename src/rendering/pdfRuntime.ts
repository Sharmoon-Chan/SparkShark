import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
let sharedWorker: pdfjs.PDFWorker | undefined;
function documentWorker() {
  if (!sharedWorker || sharedWorker.destroyed) {
    const worker = new pdfjs.PDFWorker();
    sharedWorker = worker;
    void worker.promise.catch(() => { worker.destroy(); if (sharedWorker === worker) sharedWorker = undefined; });
  }
  return sharedWorker;
}
export function openPdf(bytes: Uint8Array) {
  const base = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.origin).href;
  // PDF.js supports many documents per worker. Destroying a thumbnail's loading
  // task now frees that document without restarting the parser for every card.
  return pdfjs.getDocument({ worker: documentWorker(), data: bytes.slice(), verbosity: 0, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
}
export { pdfjs };
