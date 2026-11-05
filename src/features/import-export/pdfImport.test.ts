import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
vi.mock('../../rendering/pdfRuntime', () => ({}));
import { mayHavePhoto } from './pdfImport';

describe('PDF photo preflight', () => {
  it('skips display decoding for text-only pages', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.addPage().drawText('Resume text with no photograph', { font });
    expect(await mayHavePhoto(await pdf.save())).toBe(false);
  });

  it('detects images inside nested form resources', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    const image = pdf.context.register(pdf.context.stream(new Uint8Array([0, 0, 0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
    const form = pdf.context.register(pdf.context.flateStream('/Photo Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: { XObject: { Photo: image } } }));
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Form: form } }));
    page.node.addContentStream(pdf.context.register(pdf.context.flateStream('/Form Do')));
    expect(await mayHavePhoto(await pdf.save())).toBe(true);
  });

  it('resolves indirect image subtypes', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    const image = pdf.context.stream(new Uint8Array([0, 0, 0]), { Type: 'XObject', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    image.dict.set(PDFName.of('Subtype'), pdf.context.register(PDFName.of('Image')));
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Photo: pdf.context.register(image) } }));
    expect(await mayHavePhoto(await pdf.save())).toBe(true);
  });

  it('retains inline-image and annotation-appearance detection', async () => {
    const inline = await PDFDocument.create();
    inline.addPage().node.addContentStream(inline.context.register(inline.context.flateStream('q BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI Q')));
    expect(await mayHavePhoto(await inline.save())).toBe(true);
    const annotated = await PDFDocument.create(), page = annotated.addPage();
    const appearance = annotated.context.register(annotated.context.flateStream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
    page.node.addAnnot(annotated.context.register(annotated.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], AP: { N: appearance } })));
    expect(await mayHavePhoto(await annotated.save())).toBe(true);
  });

  it('falls back to PDF.js when lightweight inspection cannot decode a stream', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().node.addContentStream(pdf.context.register(pdf.context.stream(new Uint8Array([1, 2, 3]), { Filter: 'UnsupportedFilter' })));
    expect(await mayHavePhoto(await pdf.save())).toBe(true);
  });
});
