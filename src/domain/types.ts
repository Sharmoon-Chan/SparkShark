export type Locale = 'en' | 'fr' | 'zh-CN' | 'zh-TW' | 'ja' | 'de' | 'es' | 'pt' | 'it' | 'id' | 'ms' | 'vi';
export type Level = null | 1 | 2 | 3 | 4 | 5;
export type RichMark = { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'highlight' } | { type: 'link'; attrs: { href: string } };
export interface RichNode {
  type: 'doc' | 'paragraph' | 'text' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'codeBlock' | 'hardBreak';
  attrs?: { level?: 1 | 2 | 3; textAlign?: 'left' | 'center' | 'right' | 'justify'; start?: number };
  text?: string;
  content?: RichNode[];
  marks?: RichMark[];
}
export type RichDocument = RichNode & { type: 'doc' };
export type FieldValue = string | string[] | RichDocument | Level;
export type ItemKind = 'profiles' | 'education' | 'work' | 'projects' | 'internships' | 'skills' | 'languages' | 'awards' | 'certifications' | 'interests' | 'publications' | 'volunteer' | 'references';
export type SectionKind = ItemKind | 'summary' | 'custom';
export interface ResumeItem { id: string; visible: boolean; fields: Record<string, FieldValue> }
export type TextAlignment = 'left' | 'center' | 'right';
export type AlignmentScope = 'field' | 'row' | 'module';
export interface ContentFieldLayout { key: string; newLine: boolean; align: TextAlignment; emphasis: 'normal' | 'bold' | 'muted'; visible: boolean; inline?: boolean; rowAlign?: TextAlignment; paragraphAlign?: TextAlignment; fontSizePx?: number; fontSizeRatio?: number; italic?: boolean; underline?: boolean }
export interface SectionContentLayout { fields: ContentFieldLayout[]; rowGapPx: number; itemGapPx: number; rowAlign?: TextAlignment }
export interface SectionBase { id: string; titleOverride: string | null; visible: boolean; contentLayout?: SectionContentLayout }
export interface ItemSection extends SectionBase { kind: ItemKind; items: ResumeItem[] }
export interface SummarySection extends SectionBase { kind: 'summary'; content: RichDocument }
export type CustomFieldType = 'name' | 'description' | 'date' | 'location' | 'url' | 'keywords' | 'summary';
export interface CustomField { id: string; type: CustomFieldType; label: string; visible: boolean }
export interface CustomSection extends SectionBase {
  kind: 'custom';
  fieldDefinitions: CustomField[];
  items: { id: string; visible: boolean; values: Record<string, string | string[] | RichDocument> }[];
}
export type Section = ItemSection | SummarySection | CustomSection;
export interface Basics {
  name: string; headline: string; email: string; phone: string; website: string; location: string;
  avatarAssetId: string | null;
  customFields: { id: string; iconId: string; label: string; value: string; visible: boolean }[];
}
export interface PageGroup { id: string; main: string[]; sidebar: string[] }
export interface Layout { mode: 'single' | 'double'; sidebarSide: 'left' | 'right'; mainRatio: number; groups: PageGroup[] }
export interface Appearance {
  templateId: string; themeColor: string; fontFamilyId: string; fontSizePx: number; lineHeight: number;
  spacingScale?: number;
  marginPx: number; columnGapPx: number; density: 'compact' | 'standard' | 'loose' | 'custom';
  hideIcons: boolean; underlineLinks: boolean; pageNumbers: boolean;
  avatar: { visible: boolean; widthPx: number; aspectRatio: number; radiusPx: number; borderWidthPx: number; borderColor: string; crop: { x: number; y: number; width: number; height: number } | null };
}
export interface Resume {
  id: string; schemaVersion: 1; title: string; locale: Locale; createdAt: string; updatedAt: string; revision: number;
  basics: Basics; sections: Section[]; layout: Layout; appearance: Appearance;
}
export type ResumeSnapshot = Omit<Resume, 'id' | 'createdAt' | 'updatedAt' | 'revision'>;
export interface Asset {
  id: string; mime: 'image/png' | 'image/jpeg'; width: number; height: number; sha256: string; blob: Blob; createdAt: string;
}
export interface HistoryEntry {
  id: string; resumeId: string; createdAt: string; reason: string; snapshot: ResumeSnapshot; snapshotHash: string; restoredFrom?: string;
}
export interface StoredResume { id: string; status: 'active' | 'trashed'; deletedAt: string | null; revision: number; updatedAt: string; resume: Resume; thumbnail?: Blob; thumbnailRevision?: number }
export interface BackupAsset { id: string; mime: 'image/png' | 'image/jpeg'; width: number; height: number; sha256: string; dataBase64: string }
export interface BackupEnvelope { format: 'myresume'; schemaVersion: 1; exportedAt: string; resumes: Resume[]; assets: BackupAsset[]; histories?: HistoryEntry[] }
export interface PreparedAsset { data: Uint8Array; mime: 'image/png' | 'image/jpeg'; width: number; height: number }
export interface PreviewRegion { page: number; target: string; label: string; x: number; y: number; width: number; height: number }
export type FieldDropPlacement = 'before' | 'after' | 'above' | 'below';
export interface PreviewFieldRegion { page: number; sectionId: string; itemId: string; fieldKey: string; label: string; x: number; y: number; width: number; height: number; columnX: number; columnWidth: number; rich: boolean }
export interface PreviewAlignment { scope: AlignmentScope; value: TextAlignment }
export interface PreviewFieldAlignment extends PreviewAlignment { sectionId: string; fieldKey: string }
export interface FieldAlignmentState { field: TextAlignment | null; row: TextAlignment | null; module: TextAlignment | null }
export interface PreviewFieldDrop { sectionId: string; sourceKey: string; targetKey: string; placement: FieldDropPlacement; alignment?: PreviewAlignment }
export interface RenderResult { bytes: Uint8Array; pages: number; key: string; regions?: PreviewRegion[]; fields?: PreviewFieldRegion[] }
export type Column = 'main' | 'sidebar';
