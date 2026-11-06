# Static template illustrations

Each `<templateId>.webp` is the first and only page of a fixed, entirely fictional resume. The production cards display these image assets directly; they contain no visitors' data, external images, font references or PDF code.

Regenerate from the repository root with `pnpm exec tsx scripts/generate-template-previews.ts`. This offline authoring command uses the current template renderer and local fonts, Poppler's `pdftoppm`, and Python with Pillow/WebP. `PDFTOPPM` and `TEMPLATE_PREVIEW_PYTHON` can override the executable paths. Normal app builds use the committed images and do not need these tools.

Intermediate PDFs, a visual contact sheet and a size/hash report go to ignored `output/static-template-previews/`. The generator asserts that every illustration fits one page and the complete WebP catalog stays below 500 KiB. Import these files through Vite so deployment URLs include content hashes.
