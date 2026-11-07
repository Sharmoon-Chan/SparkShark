import React, { type ReactElement, type ReactNode } from 'react';
import { Document, Image, Link, Page, Path, pdf, Svg, Text, View } from '@react-pdf/renderer';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { CustomSection, PreparedAsset, PreviewFieldRegion, PreviewRegion, Resume, ResumeItem, RichNode, Section, TextAlignment } from '../domain/types';
import { hasContent, richText, safeLink } from '../domain/resume';
import { sectionTitle } from '../domain/registry';
import { checkGlyphs, fontFamily, prepareFonts } from './fonts';
import { basicsView, compactItemView, inlineBasicsView, primaryKeyFor, visiblePageGroups } from './viewModel';
import { preparePdfImportMarkers } from './importMarkers';
import { extractPreviewRegions, type PreviewLayoutNode } from './previewRegions';
import { templateDesign } from '../domain/templates';
import { readableThemeColor } from './colors';
import { contentFieldSpecs, resolveContentLayout } from '../domain/contentLayout';
import { contentFontSize, contentRowPresentation, contentTextDecoration, moduleContentRows, type ContentCell } from './contentLayoutView';
import { RESUME_TYPE_SCALE, resumeTypeSize } from '../domain/typography';
import { extractPreviewFields, previewFieldId } from './previewFields';
import { avatarFrame } from '../domain/avatar';

import { A4, pt } from './constants';
export { A4, pt } from './constants';
type LayoutNode = PreviewLayoutNode;
type PdfAssetMap = Record<string, PreparedAsset>;
interface Context { resume: Resume; font: string; size: number; line: number; spacing: number; theme: string; width: number; height: number; blockedLinks: ReadonlySet<string>; italic?: boolean; underline?: boolean; paragraphAlign?: TextAlignment; defaultTextAlign?: TextAlignment }
const makeContext = (resume: Resume, blockedLinks: ReadonlySet<string>): Context => ({ resume, font: fontFamily(resume.appearance.fontFamilyId), size: pt(resume.appearance.fontSizePx), line: resume.appearance.lineHeight, spacing: resume.appearance.spacingScale ?? 1, theme: readableThemeColor(resume.appearance.themeColor), width: A4.width - pt(resume.appearance.marginPx) * 2, height: A4.height - pt(resume.appearance.marginPx) * 2, blockedLinks });

function segments(text: string, code: boolean, font: string, italic = false): ReactNode {
  if (!code) return text;
  return text.split(/([^\x00-\x7F]+)/g).filter(Boolean).map((part, i) => { const ascii = /^[\x00-\x7F]*$/.test(part); return <Text key={i} style={{ fontFamily: ascii ? italic ? 'Courier-Oblique' : 'Courier' : font, fontStyle: ascii ? 'normal' : undefined }}>{part}</Text>; });
}
function Inline({ node, context }: { node: RichNode; context: Context }) {
  if (node.type === 'hardBreak') return <Text>{'\n'}</Text>;
  const marks = node.marks ?? [];
  const mark = (type: string) => marks.some(m => m.type === type);
  const link = marks.find(m => m.type === 'link');
  const italic = mark('italic') || Boolean(context.italic), underline = mark('underline') || Boolean(context.underline);
  const style = { fontWeight: mark('bold') ? 700 : 400, fontStyle: italic ? 'italic' as const : 'normal' as const,
    textDecoration: contentTextDecoration(underline, mark('strike')),
    backgroundColor: mark('highlight') ? '#FEF08A' : undefined };
  const content = segments(node.text ?? '', mark('code'), context.font, italic);
  if (link?.type === 'link' && !context.blockedLinks.has(link.attrs.href) && safeLink(link.attrs.href)) return <Link src={safeLink(link.attrs.href)!} style={{ ...style, color: context.theme, textDecoration: contentTextDecoration(underline || context.resume.appearance.underlineLinks, mark('strike')) }}>{content}</Link>;
  return <Text style={style}>{content}</Text>;
}
function Rich({ node, context, depth = 0, id, prefix }: { node: RichNode; context: Context; depth?: number; id?: string; prefix?: { text: string; width: number } }): ReactElement {
  const children = node.content ?? [];
  if (node.type === 'doc' || node.type === 'listItem') return <View id={id}>{prefix && !children.length && <Text>{prefix.text}</Text>}{children.map((child, index) => <Rich key={index} node={child} context={context} depth={depth} prefix={index === 0 ? prefix : undefined} />)}</View>;
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const width = context.size * (node.type === 'orderedList' ? 1.7 : 1.15);
    // The marker and first paragraph share one text layout, so widow/orphan
    // protection cannot move the paragraph while leaving its marker behind.
    return <View id={id} style={{ marginBottom: context.size * .3 * context.spacing }}>{prefix && <Text minPresenceAhead={context.size * context.line * 2}>{prefix.text}</Text>}{children.map((child, index) => <View key={index} style={{ paddingLeft: width, marginBottom: 2 * context.spacing }}>
      <Rich node={child} context={context} depth={depth + 1} prefix={{ text: node.type === 'orderedList' ? `${(node.attrs?.start ?? 1) + index}. ` : '• ', width }} />
    </View>)}</View>;
  }
  if (node.type === 'codeBlock') return <View id={id} style={{ backgroundColor: '#F4F5F6', padding: 5 * context.spacing, marginBottom: 5 * context.spacing }}><Text orphans={2} widows={2} style={{ fontSize: context.size * .9, lineHeight: context.line, textAlign: context.paragraphAlign ?? context.defaultTextAlign, fontStyle: context.italic ? 'italic' : undefined, textDecoration: context.underline ? 'underline' : undefined }}>{prefix && <Text>{prefix.text}</Text>}{segments(richText(node), true, context.font, context.italic)}</Text></View>;
  if (node.type === 'text' || node.type === 'hardBreak') return <Inline node={node} context={context} />;
  const heading = node.type === 'heading';
  return <Text id={id} orphans={2} widows={2} minPresenceAhead={heading ? context.size * context.line * 2 : undefined} style={{ marginBottom: context.size * .35 * context.spacing, fontSize: heading ? context.size * ({ 1: 1.5, 2: 1.25, 3: 1.1 }[node.attrs?.level ?? 3]) : context.size,
    fontWeight: heading ? 700 : 400, textAlign: context.paragraphAlign ?? node.attrs?.textAlign ?? context.defaultTextAlign ?? 'left', lineHeight: context.line, textIndent: prefix ? -prefix.width : undefined }}>
    {prefix && <Text style={{ fontFamily: context.font, fontWeight: 400, textIndent: -prefix.width }}>{prefix.text}</Text>}
    {children.map((child, index) => <Inline key={index} node={child} context={context} />)}
  </Text>;
}
const paths = {
  location: 'M8 15s5-4.5 5-9a5 5 0 0 0-10 0c0 4.5 5 9 5 9zM8 4v4',
  mail: 'M2 3h12v10H2zM2 3l6 5 6-5',
  phone: 'M4 2l3 3-2 2 4 4 2-2 3 3-2 2c-5 0-10-5-10-10z',
  globe: 'M8 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14M1 8h14M8 1c-4 4-4 10 0 14M8 1c4 4 4 10 0 14',
};
function ContactIcon({ kind, size, color = '#616B66' }: { kind: keyof typeof paths; size: number; color?: string }) { return <Svg width={size} height={size} viewBox="0 0 16 16" style={{ marginRight: 3, marginTop: 2 }}><Path d={paths[kind]} stroke={color} strokeWidth={1} fill="none" /></Svg>; }
function tint(hex: string, white = .9): string { return '#' + [1, 3, 5].map(index => Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - white) + 255 * white).toString(16).padStart(2, '0')).join(''); }
function shade(hex: string): string { return '#' + [1, 3, 5].map(index => Math.round(parseInt(hex.slice(index, index + 2), 16) * .35).toString(16).padStart(2, '0')).join(''); }
function BasicsPdf({ resume, assets, context }: { resume: Resume; assets: PdfAssetMap; context: Context }) {
  const basics = resume.basics;
  const avatar = avatarFrame(resume.appearance.avatar);
  const image = basics.avatarAssetId ? assets[basics.avatarAssetId] : undefined;
  let imageSrc = '';
  if (image) { let binary = ''; for (let i = 0; i < image.data.length; i += 32768) binary += String.fromCharCode(...image.data.subarray(i, i + 32768)); imageSrc = `data:${image.mime};base64,${btoa(binary)}`; }
  const { contacts, customFields } = basicsView(basics);
  const design = templateDesign(resume.appearance.templateId);
  const contactColor = design.darkHeader ? '#E2E8F0' : '#4C5650';
  const nameColor = design.darkHeader ? '#FFFFFF' : design.classic ? '#0F172A' : context.theme;
  const classicContacts = inlineBasicsView(basics);
  const banner = design.darkHeader || design.tintedHeader || design.lightHeader || design.outlineHeader;
  return <View id="preview-basics" style={{ paddingBottom: 14 * context.spacing }}>{design.tintedHeader && <View style={{ flexDirection: 'row', height: 4, marginBottom: 4 * context.spacing }}>{Array.from({ length: 32 }, (_, index) => <View key={index} style={{ width: '3.125%', height: 4, backgroundColor: tint(context.theme, index / 40) }} />)}</View>}<View style={{
    flexDirection: design.centeredHeader ? 'column' : design.rightPhoto ? 'row-reverse' : 'row', alignItems: design.classic || design.centeredHeader ? 'center' : 'flex-start', justifyContent: design.classic ? 'space-between' : undefined,
    backgroundColor: design.darkHeader ? shade(context.theme) : design.tintedHeader || design.lightHeader ? tint(context.theme, .91) : undefined,
    padding: banner ? 13 : 0, paddingTop: (design.headerRule || design.topRule ? 9 : banner ? 13 : 0) * context.spacing, paddingBottom: (design.headerRule ? 9 : banner ? 13 : 0) * context.spacing,
    borderTopWidth: design.outlineHeader ? .75 : resume.appearance.templateId === 'modern' || design.topRule ? 3 : 0, borderTopColor: context.theme,
    borderBottomWidth: design.outlineHeader ? .75 : design.headerRule ? design.editorial ? 1.5 : .7 : 0, borderBottomColor: context.theme,
    borderLeftWidth: design.outlineHeader ? .75 : design.accentHeader ? 4 : 0, borderLeftColor: context.theme,
    borderRightWidth: design.outlineHeader ? .75 : 0, borderRightColor: context.theme,
    paddingLeft: design.accentHeader ? 13 : banner ? 13 : 0,
    borderRadius: design.tintedHeader || design.lightHeader ? 7 : 0,
  }}>
    {avatar.visible && image && <Image src={imageSrc} style={{ width: pt(avatar.widthPx), height: pt(avatar.widthPx / avatar.aspectRatio), flexShrink: 0, borderRadius: pt(avatar.radiusPx), borderWidth: pt(avatar.borderWidthPx), borderColor: avatar.borderColor, objectFit: 'cover', marginBottom: design.centeredHeader ? 8 * context.spacing : 0, marginRight: design.centeredHeader ? 0 : design.classic ? pt(4) : !design.rightPhoto ? 13 : 0, marginLeft: design.classic ? 0 : design.rightPhoto ? 13 : 0 }} />}
    <View style={{ flex: design.centeredHeader ? undefined : 1, width: design.centeredHeader ? '100%' : undefined, minWidth: 0, textAlign: design.centeredHeader ? 'center' : 'left' }}>
      {basics.name && <Text style={{ fontSize: context.size * (design.editorial ? 2.65 : 2.1), fontWeight: 700, color: nameColor, marginBottom: 3 * context.spacing, lineHeight: 1.15 }}>{basics.name}</Text>}
      {basics.headline && <Text style={{ fontSize: context.size * 1.4, marginBottom: 5 * context.spacing, fontWeight: 700, lineHeight: 1.2, color: design.darkHeader ? '#FFFFFF' : context.theme }}>{basics.headline}</Text>}
      {design.classic ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{classicContacts.filter(contact => contact.text.trim()).map((contact, index, all) => <View key={index} style={{ maxWidth: '100%', marginBottom: 3 * context.spacing, paddingRight: index < all.length - 1 ? 7 : 0, marginRight: index < all.length - 1 ? 7 : 0, borderRightWidth: index < all.length - 1 ? .5 : 0, borderRightColor: '#CBD5E1' }}><Text style={{ color: contactColor, fontSize: context.size }}>{contact.href && !context.blockedLinks.has(contact.value) ? <Link src={contact.href} style={{ color: contactColor, textDecoration: resume.appearance.underlineLinks ? 'underline' : 'none' }}>{contact.text}</Link> : contact.text}</Text></View>)}</View> : <><View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: design.centeredHeader ? 'center' : undefined }}>{contacts.filter(contact => contact.value.trim()).map((contact, index) => <View key={index} style={{ flexDirection: 'row', marginRight: 10, marginBottom: 3 * context.spacing, maxWidth: '100%' }}>
        {!resume.appearance.hideIcons && <ContactIcon kind={contact.icon} size={context.size * .85} color={design.darkHeader ? '#CBD5E1' : '#616B66'} />}
        {contact.href && !context.blockedLinks.has(contact.value) ? <Link src={contact.href} style={{ color: contactColor, fontSize: context.size, textDecoration: resume.appearance.underlineLinks ? 'underline' : 'none' }}>{contact.value}</Link> : <Text style={{ color: contactColor, fontSize: context.size }}>{contact.value}</Text>}
      </View>)}</View>
      {customFields.map(field => <Text key={field.id} style={{ color: contactColor, fontSize: context.size, marginTop: 2 * context.spacing }}>{field.label ? `${field.label}：` : ''}{field.value}</Text>)}</>}
    </View>
  </View></View>;
}
function SectionTitlePdf({ section, context }: { section: Section; context: Context }) {
  const { resume, size, theme } = context;
  const template = resume.appearance.templateId;
  const design = templateDesign(template);
  const title = sectionTitle(section, resume.locale);
  const enclosed = design.titleFill || design.titleSolid || design.titleOutline || design.titleDoubleRule;
  const titleStyle = { fontSize: resumeTypeSize(size, 'section'), fontWeight: design.classic ? 600 : 700, color: design.titleSolid ? '#FFFFFF' : design.classic ? '#1E293B' : template === 'clean' ? '#222D26' : theme, lineHeight: design.classic ? 10 / 7 : undefined, marginBottom: enclosed ? 0 : 3 * context.spacing, flexShrink: design.titleDot ? 1 : undefined, flexGrow: design.titleDot ? 1 : undefined, minWidth: 0 };
  return title ? <View minPresenceAhead={size * context.line * (context.spacing < 1 ? 2 : 3)} style={{
    borderTopWidth: design.titleDoubleRule || design.titleOutline ? .65 : 0, borderTopColor: theme,
    borderBottomWidth: design.titleDoubleRule || design.titleOutline || design.titleRule ? .65 : 0, borderBottomColor: design.titleDoubleRule || design.titleOutline ? theme : '#CBD8D0',
    borderLeftWidth: design.titleOutline ? .65 : design.titleBar ? 2.5 : 0, borderLeftColor: theme,
    borderRightWidth: design.titleOutline ? .65 : 0, borderRightColor: theme,
    backgroundColor: design.titleSolid ? theme : design.titleFill ? tint(theme, design.classic ? .7 : .91) : undefined,
    paddingLeft: design.classic ? 6 : design.titleBar || design.titleSolid || design.titleOutline ? 7 : design.titleFill ? 7 : 0,
    paddingRight: design.titleSolid || design.titleOutline ? 7 : 0,
    paddingTop: (enclosed ? 3 : 0) * context.spacing, paddingBottom: (enclosed ? 3 : design.titleRule ? .5 : 0) * context.spacing,
    flexDirection: design.titleDot ? 'row' : undefined, alignItems: design.titleDot ? 'flex-start' : undefined,
    borderRadius: template === 'leafish' ? 5 : 0, marginBottom: enclosed || design.titleBar || design.titleShortRule ? 5 * context.spacing : 0,
  }}>{design.titleDot && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme, flexShrink: 0, marginRight: 6, marginTop: size * .48 }} />}<Text style={titleStyle}>{title}</Text>{design.titleShortRule && <View style={{ width: 28, height: 1.5, backgroundColor: theme, marginTop: 1 * context.spacing }} />}</View> : null;
}

// A conservative bound keeps only small blocks unbreakable. Very long names,
// custom fields and narrative text still paginate instead of overflowing.
function textHeightBound(text: string, context: Context, width = context.width, scale = 1): number {
  if (!text) return 0;
  const size = context.size * scale;
  return text.split(/\r?\n/).reduce((height, line) => height + Math.max(1, Math.ceil(Array.from(line).length * size * 2 / Math.max(16, width))) * size * context.line + size * .5, 0);
}
function richNodeCount(node: RichNode): number { return 1 + (node.content ?? []).reduce((count, child) => count + richNodeCount(child), 0); }

function ItemPdf({ section, item, first, context }: { section: Exclude<Section, CustomSection | { kind: 'summary' }>; item: ResumeItem; first: boolean; context: Context }) {
  const { resume, size, theme } = context;
  const display = compactItemView(section.kind, item);
  const fieldId = (key: string) => previewFieldId(section.id, item.id, key);
  const captionFields = [...display.details.filter(field => field.key !== 'dateText'), ...(display.keywords.length ? [{ key: 'keywords', value: display.keywords.join(' · ') }] : [])];
  const classicCaption = templateDesign(resume.appearance.templateId).classic && (section.kind === 'work' || section.kind === 'internships');
  const leftCaption = [...display.details.filter(field => field.key !== 'dateText' && field.key !== 'location').map(field => field.value), ...(display.keywords.length ? [display.keywords.join(' · ')] : [])].join(' · ');
  const location = display.details.find(field => field.key === 'location')?.value ?? '';
  const compactSkill = section.kind === 'skills';
  const single = resume.layout.mode === 'single';
  const rightLabel = display.date || (single && display.level !== null ? `${display.level} / 5` : '');
  const title = first ? <SectionTitlePdf section={section} context={context} /> : null;
  const titleHeight = first ? textHeightBound(sectionTitle(section, resume.locale), context, context.width, RESUME_TYPE_SCALE.section) + 12 : 0;
  const headerHeight = titleHeight + Math.max(textHeightBound(display.primary, context, context.width * .4, RESUME_TYPE_SCALE.entry), textHeightBound(rightLabel, context, context.width * .4))
    + textHeightBound(display.caption, context) + display.links.reduce((height, link) => height + textHeightBound(link.value, context), 0) + 12;
  const protectHeader = headerHeight < context.height * .45;
  const summary = display.summary && hasContent(display.summary) ? display.summary : null;
  const protectItem = protectHeader && (!summary || (richText(summary).length <= 180 && richNodeCount(summary) <= 12
    && headerHeight + textHeightBound(richText(summary), context, context.width, 1.5) < context.height * .45));
  const header = <>
    {title}
    {(display.primary || rightLabel) && <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 * context.spacing }}>
      {display.primary && <Text id={fieldId(primaryKeyFor(section.kind))} style={{ fontSize: resumeTypeSize(size, 'entry'), fontWeight: 700, flexShrink: 1, flexGrow: 1, minWidth: 0 }}>{display.primary}</Text>}
      {rightLabel && <Text id={fieldId(display.date ? 'dateText' : 'level')} style={{ fontSize: size, color: '#59635D', textAlign: 'right', marginLeft: display.primary ? 8 : 0, maxWidth: display.primary ? '46%' : '100%', flexShrink: 0 }}>{rightLabel}</Text>}
    </View>}
    {display.caption && (classicCaption ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 * context.spacing }}>{leftCaption && <Text id={fieldId('position')} style={{ fontSize: size, color: '#64748B', flex: 1 }}>{leftCaption}</Text>}{location && <Text id={fieldId('location')} style={{ fontSize: size, color: '#64748B', textAlign: 'right', maxWidth: leftCaption ? '46%' : '100%', marginLeft: leftCaption ? 8 : 0 }}>{location}</Text>}</View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: (compactSkill ? 2 : 3) * context.spacing }}>{captionFields.map((field, index) => <Text id={fieldId(field.key)} key={field.key} style={{ maxWidth: '100%', fontSize: size, color: '#59635D' }}>{field.value}{index < captionFields.length - 1 ? ' · ' : ''}</Text>)}</View>)}
    {display.links.map(link => <Text id={fieldId(link.key)} key={link.key} style={{ fontSize: size, marginBottom: 3 * context.spacing }}>{link.href && !context.blockedLinks.has(link.value) ? <Link src={link.href} style={{ color: theme, textDecoration: resume.appearance.underlineLinks ? 'underline' : 'none' }}>{link.value}</Link> : link.value}</Text>)}
    {!single && display.level !== null && <View id={fieldId('level')} style={{ marginTop: (compactSkill ? 2 : 3) * context.spacing, marginBottom: (compactSkill ? 2 : 4) * context.spacing, height: 3, backgroundColor: '#E6EAE7', width: '55%' }}><View style={{ height: 3, width: `${display.level * 20}%`, backgroundColor: theme }} /></View>}
  </>;
  const marginBottom = size * (compactSkill ? .25 : .6) * context.spacing;
  const body = summary && <Rich id={fieldId('summary')} node={summary} context={context} />;
  if (protectItem) return <View wrap={false} style={{ marginBottom }}>{header}{body}</View>;
  // Place long-item headers in the section flow so presence can move them
  // together with the first body lines instead of stranding them at a page end.
  return <><View wrap={!protectHeader} minPresenceAhead={protectHeader && summary ? size * context.line * 2 : undefined} style={{ marginBottom: summary ? 0 : marginBottom }}>{header}</View>{summary && <View style={{ marginBottom }}>{body}</View>}</>;
}

function CustomItemPdf({ section, item, first, context }: { section: CustomSection; item: CustomSection['items'][number]; first: boolean; context: Context }) {
  const fields = section.fieldDefinitions.filter(field => field.visible && hasContent(item.values[field.id]));
  const { resume, size, theme } = context;
  const fieldText = (field: typeof fields[number]) => { const value = item.values[field.id]; return typeof value === 'string' ? value : Array.isArray(value) ? value.join(' · ') : richText(value); };
  const fieldView = (field: typeof fields[number]) => {
    const value = item.values[field.id];
    if (value && typeof value === 'object' && !Array.isArray(value)) return <Rich id={previewFieldId(section.id, item.id, field.id)} key={field.id} node={value} context={context} />;
    if (field.type === 'url' && typeof value === 'string' && !context.blockedLinks.has(value) && safeLink(value)) return <Text id={previewFieldId(section.id, item.id, field.id)} key={field.id}><Link src={safeLink(value)!} style={{ color: theme, textDecoration: resume.appearance.underlineLinks ? 'underline' : 'none' }}>{value}</Link></Text>;
    return <Text id={previewFieldId(section.id, item.id, field.id)} key={field.id} style={{ fontSize: resumeTypeSize(size, field.type === 'name' ? 'entry' : 'body'), fontWeight: field.type === 'name' ? 700 : 400, marginBottom: 3 * context.spacing }}>{fieldText(field)}</Text>;
  };
  const title = first ? <SectionTitlePdf section={section} context={context} /> : null;
  const titleHeight = first ? textHeightBound(sectionTitle(section, resume.locale), context, context.width, RESUME_TYPE_SCALE.section) + 12 : 0;
  const allHeight = fields.reduce((height, field) => height + textHeightBound(fieldText(field), context, context.width, 1.5) + size, titleHeight);
  const short = allHeight < context.height * .35 && fields.length <= 8;
  const firstField = fields[0];
  const protectFirst = firstField && firstField.type !== 'summary' && titleHeight + textHeightBound(fieldText(firstField), context) < context.height * .35;
  return <View wrap={!short} style={{ marginBottom: 7 * context.spacing }}>
    {short ? <>{title}{fields.map(fieldView)}</> : <>
      {protectFirst ? <View wrap={false}>{title}{fieldView(firstField)}</View> : <>{title}{firstField && fieldView(firstField)}</>}
      {fields.slice(1).map(fieldView)}
    </>}
  </View>;
}

function contextForCell(context: Context, cell: ContentCell): Context {
  return { ...context, size: pt(contentFontSize(cell.layout, context.size / .75, cell.spec)), italic: cell.layout.italic, underline: cell.layout.underline, paragraphAlign: cell.layout.paragraphAlign, defaultTextAlign: cell.layout.rowAlign };
}

function ContentRowPdf({ row, gap, context, sectionId, itemId }: { row: ContentCell[]; gap: number; context: Context; sectionId: string; itemId: string }) {
  const height = Math.max(...row.map(cell => textHeightBound(cell.text, contextForCell(context, cell), context.width / row.length)));
  const rich = row.some(cell => cell.rich);
  const { inline: inlineRow, alignment: rowAlign, justify } = contentRowPresentation(row);
  return <View wrap={rich || height > context.height * .35} style={{ flexDirection: 'row', flexWrap: inlineRow ? 'wrap' : undefined, justifyContent: rowAlign ? justify : undefined, gap: rowAlign ? pt(8) : undefined, marginBottom: gap }}>{row.map((cell, index) => {
    const { layout, spec, text } = cell;
    const fieldContext = contextForCell(context, cell);
    const colour = layout.emphasis === 'muted' ? '#59635D' : templateDesign(context.resume.appearance.templateId).classic ? '#0F172A' : '#27312B';
    const style = { fontSize: fieldContext.size, color: colour, fontWeight: layout.emphasis === 'bold' ? 700 : 400, textAlign: layout.align, fontStyle: layout.italic ? 'italic' as const : 'normal' as const, textDecoration: contentTextDecoration(Boolean(layout.underline)) };
    const natural = inlineRow && (rowAlign ? layout.inline !== false : spec.type !== 'level' && (layout.inline || layout.align === 'right'));
    const groupLevel = Boolean(rowAlign && spec.type === 'level' && context.resume.layout.mode === 'double');
    return <View id={previewFieldId(sectionId, itemId, layout.key)} key={layout.key} style={{ flexGrow: natural ? 0 : 1, flexShrink: 1, flexBasis: natural ? 'auto' : 0, minWidth: 0, maxWidth: '100%', width: groupLevel ? context.width * .55 : undefined, marginLeft: natural && !rowAlign && layout.align === 'right' ? 'auto' : 0, marginRight: !rowAlign && index < row.length - 1 ? pt(8) : 0, fontSize: fieldContext.size }}>
      {cell.rich ? <Rich node={cell.rich} context={fieldContext} /> : spec.type === 'level' && typeof cell.value === 'number' && context.resume.layout.mode === 'double' ? <View style={{ alignItems: layout.align === 'right' ? 'flex-end' : layout.align === 'center' ? 'center' : 'flex-start', paddingTop: 3 * context.spacing, paddingBottom: 3 * context.spacing }}><View style={{ width: groupLevel ? '100%' : '55%', height: 3, backgroundColor: '#E6EAE7' }}><View style={{ width: `${cell.value * 20}%`, height: 3, backgroundColor: context.theme }} /></View></View> : <Text orphans={2} widows={2} style={style}>{cell.href && !context.blockedLinks.has(text) ? <Link src={cell.href} style={{ color: layout.emphasis === 'muted' ? colour : context.theme, textDecoration: contentTextDecoration(Boolean(layout.underline) || context.resume.appearance.underlineLinks) }}>{text}</Link> : text}</Text>}
    </View>;
  })}</View>;
}

function ContentItemPdf({ section, rows, first, context, itemId }: { section: Section; rows: ContentCell[][]; first: boolean; context: Context; itemId: string }) {
  const settings = resolveContentLayout(section), rowGap = pt(settings.rowGapPx);
  const height = rows.reduce((total, row) => total + Math.max(...row.map(cell => textHeightBound(cell.text, contextForCell(context, cell), context.width / row.length, cell.rich ? 1.5 : 1))) + rowGap, 0);
  const titleHeight = first ? textHeightBound(sectionTitle(section, context.resume.locale), context, context.width, 1.5) + 12 : 0;
  const short = height + titleHeight < context.height * .35 && rows.every(row => row.every(cell => !cell.rich || richNodeCount(cell.rich) <= 12));
  const richIndex = rows.findIndex(row => row.some(cell => cell.rich));
  const headerRows = rows.slice(0, richIndex < 0 ? rows.length : richIndex);
  const rest = rows.slice(headerRows.length);
  const headerHeight = headerRows.reduce((total, row) => total + Math.max(...row.map(cell => textHeightBound(cell.text, contextForCell(context, cell), context.width / row.length))) + rowGap, titleHeight);
  const title = first ? <SectionTitlePdf section={section} context={context} /> : null;
  const rowView = (row: ContentCell[], index: number) => <ContentRowPdf key={row.map(cell => cell.layout.key).join(':')} row={row} gap={index < rows.length - 1 ? rowGap : 0} context={context} sectionId={section.id} itemId={itemId} />;
  return <View wrap={!short} style={{ marginBottom: pt(settings.itemGapPx) }}>{short ? <>{title}{rows.map(rowView)}</> : <><View wrap={headerHeight > context.height * .35} minPresenceAhead={rest.length ? context.size * context.line * 2 + rowGap : undefined}>{title}{headerRows.map(rowView)}</View>{rest.map((row, index) => rowView(row, index + headerRows.length))}</>}</View>;
}

function ConfiguredSectionPdf({ section, context, last }: { section: Section; context: Context; last: boolean }) {
  const entries = section.kind === 'summary' ? [{ itemId: section.id, rows: moduleContentRows(section) }] : section.items.filter(item => item.visible).map(item => ({ itemId: item.id, rows: moduleContentRows(section, item) })).filter(entry => entry.rows.length > 0);
  if (!entries.some(entry => entry.rows.length > 0)) return null;
  return <View id={`preview-section-${section.id}`} style={{ marginBottom: last && context.spacing > 1 ? 0 : context.size * .95 * context.spacing }}>{entries.map((entry, index) => <ContentItemPdf key={entry.itemId} section={section} rows={entry.rows} first={index === 0} context={context} itemId={entry.itemId} />)}</View>;
}

function SectionPdf({ section, context, last }: { section: Section; context: Context; last: boolean }) {
  if (section.contentLayout) return <ConfiguredSectionPdf section={section} context={context} last={last} />;
  const marginBottom = last && context.spacing > 1 ? 0 : context.size * .95 * context.spacing;
  if (section.kind === 'summary') {
    const first = section.content.content?.[0];
    const keepFirst = first && richNodeCount(first) <= 8 && textHeightBound(richText(first), context, context.width, 1.5)
      + textHeightBound(sectionTitle(section, context.resume.locale), context, context.width, RESUME_TYPE_SCALE.section) + 12 < context.height * .35;
    return <View id={`preview-section-${section.id}`} style={{ marginBottom }}>{keepFirst ? <>
      <View wrap={false}><SectionTitlePdf section={section} context={context} /><Rich id={previewFieldId(section.id, section.id, 'summary')} node={first} context={context} /></View>
      <Rich id={previewFieldId(section.id, section.id, 'summary')} node={{ ...section.content, content: section.content.content?.slice(1) }} context={context} />
    </> : <><SectionTitlePdf section={section} context={context} /><Rich id={previewFieldId(section.id, section.id, 'summary')} node={section.content} context={context} /></>}</View>;
  }
  const items = section.items.filter(item => item.visible && Object.values('fields' in item ? item.fields : item.values).some(hasContent));
  return <View id={`preview-section-${section.id}`} style={{ marginBottom }}>{items.map((item, index) => section.kind === 'custom'
    ? <CustomItemPdf key={item.id} section={section} item={item as CustomSection['items'][number]} first={index === 0} context={context} />
    : <ItemPdf key={item.id} section={section} item={item as ResumeItem} first={index === 0} context={context} />)}</View>;
}
async function renderDocument(element: ReactElement): Promise<{ document: PDFDocument; layout?: LayoutNode }> {
  let layout: LayoutNode | undefined;
  const original = element.props as { children: ReactNode };
  const blob = await pdf(React.createElement(Document, { ...original, onRender: data => { layout = (data as { _INTERNAL__LAYOUT__DATA_?: LayoutNode })._INTERNAL__LAYOUT__DATA_; } })).toBlob();
  return { document: await PDFDocument.load(await blob.arrayBuffer()), layout };
}
function copyLinks(source: ReturnType<PDFDocument['getPages']>[number], destination: ReturnType<PDFDocument['getPages']>[number], document: PDFDocument, x: number, y: number) {
  const annots = source.node.Annots();
  if (!annots) return;
  for (let i = 0; i < annots.size(); i++) {
    const annotation = annots.lookup(i, PDFDict);
    const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
    const rectangle = annotation.lookupMaybe(PDFName.of('Rect'), PDFArray);
    if (!action || !rectangle || action.get(PDFName.of('S')) !== PDFName.of('URI')) continue;
    const uri = action.lookup(PDFName.of('URI'));
    if (!(uri instanceof PDFString) && !(uri instanceof PDFHexString)) continue;
    const target = safeLink(uri.decodeText()); if (!target) continue;
    const rect = Array.from({ length: 4 }, (_, index) => Number(String(rectangle.lookup(index))) + (index % 2 === 0 ? x : y));
    const link = document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(target) } });
    destination.node.addAnnot(document.context.register(link));
  }
}
function color(hex: string) { return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255); }

export async function renderResume(resume: Resume, assets: PdfAssetMap = {}, fontBase = '/fonts', profile?: (stage: string, ms: number) => void, signal?: AbortSignal): Promise<{ bytes: Uint8Array; pages: number; regions: PreviewRegion[]; fields: PreviewFieldRegion[] }> {
  const checkpoint = async () => {
    // Yield to worker cancellation messages between the expensive PDF stages.
    if (signal) await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  };
  await checkpoint();
  let stageStart = performance.now();
  const prepared = preparePdfImportMarkers(resume); resume = prepared.resume;
  checkGlyphs(resume); await prepareFonts(resume, fontBase, signal);
  profile?.('font-check', performance.now() - stageStart);
  const context = makeContext(resume, prepared.blockedLinks), margin = pt(resume.appearance.marginPx);
  const footerY = Math.max(pt(32), margin / 2);
  const footer = resume.appearance.pageNumbers ? Math.max(0, footerY + 12 - margin) : 0;
  const availableHeight = A4.height - margin * 2 - footer, availableWidth = A4.width - margin * 2;
  const output = await PDFDocument.create();
  const regions: PreviewRegion[] = [];
  const fields: PreviewFieldRegion[] = [];
  const fieldLabels = Object.fromEntries(resume.sections.map(section => [section.id, Object.fromEntries(contentFieldSpecs(section).map(spec => [spec.key, spec.label]))]));
  const richFields = Object.fromEntries(resume.sections.map(section => [section.id, contentFieldSpecs(section).filter(spec => spec.type === 'rich').map(spec => spec.key)]));
  const labels = { basics: '基本信息', ...Object.fromEntries(resume.sections.map(section => [section.id, sectionTitle(section, resume.locale) || '未命名模块'])) };
  output.setTitle(resume.title); output.setCreator('SparkShark'); output.setProducer('SparkShark · react-pdf / pdf-lib');
  const baseStyle = { fontFamily: context.font, fontSize: context.size, lineHeight: context.line, color: templateDesign(resume.appearance.templateId).classic ? '#0F172A' : '#27312B' };
  const hasBasics = Object.entries(resume.basics).some(([key, value]) => key !== 'avatarAssetId' && typeof value === 'string' && value.trim()) || resume.basics.customFields.some(field => field.visible && (field.label || field.value)) || Boolean(resume.appearance.avatar.visible && resume.basics.avatarAssetId && assets[resume.basics.avatarAssetId]);
  stageStart = performance.now();
  const header = hasBasics ? await renderDocument(<Document><Page size="A4" style={{ ...baseStyle, padding: margin, paddingBottom: margin + footer }}><BasicsPdf resume={resume} assets={assets} context={context} /></Page></Document>) : null;
  profile?.('header', performance.now() - stageStart);
  await checkpoint();
  const headerHeight = header?.layout?.children?.[0]?.children?.[0]?.box?.height ?? 0;
  const headerSeparate = Boolean(header && (header.document.getPageCount() > 1 || headerHeight > availableHeight - context.size * context.line * 4));
  if (header) regions.push(...extractPreviewRegions(header.layout, { labels, clipWidth: A4.width, clipHeight: A4.height }));
  const embed = async (source: ReturnType<PDFDocument['getPages']>[number], target: ReturnType<PDFDocument['getPages']>[number], x: number, y: number) => { const [page] = await output.embedPages([source]); target.drawPage(page, { x, y }); copyLinks(source, target, output, x, y); };
  if (headerSeparate && header) for (const source of header.document.getPages()) { const target = output.addPage([A4.width, A4.height]); await embed(source, target, 0, 0); }
  const groups = visiblePageGroups(resume);
  let firstBody = true;
  for (const group of groups) {
    const isDouble = resume.layout.mode === 'double';
    const gap = isDouble ? pt(resume.appearance.columnGapPx) : 0;
    const mainWidth = isDouble ? (availableWidth - gap) * resume.layout.mainRatio : availableWidth;
    const sideWidth = isDouble ? availableWidth - gap - mainWidth : 0;
    const reserve = firstBody && !headerSeparate ? headerHeight : 0;
    const makeColumn = async (sections: Section[], width: number) => {
      if (!sections.length || width <= 0) return null;
      const start = performance.now();
      const columnContext = { ...context, width, height: availableHeight };
      const result = await renderDocument(<Document><Page size={{ width, height: availableHeight }} style={baseStyle}>{reserve > 0 && <View style={{ height: reserve, flexShrink: 0 }} />}{sections.map((section, index) => <SectionPdf key={section.id} section={section} context={columnContext} last={index === sections.length - 1} />)}</Page></Document>);
      profile?.('column', performance.now() - start);
      await checkpoint();
      return result;
    };
    const main = await makeColumn(isDouble ? group.main : [...group.main, ...group.sidebar], mainWidth);
    const sidebar = isDouble ? await makeColumn(group.sidebar, sideWidth) : null;
    const pages = Math.max(main?.document.getPageCount() ?? 0, sidebar?.document.getPageCount() ?? 0, 1);
    const mainX = isDouble && resume.layout.sidebarSide === 'left' ? margin + sideWidth + gap : margin;
    const sidebarX = resume.layout.sidebarSide === 'left' ? margin : margin + mainWidth + gap;
    const pageOffset = output.getPageCount();
    if (main) regions.push(...extractPreviewRegions(main.layout, { labels, pageOffset, offsetX: mainX, offsetY: margin, clipWidth: mainWidth, clipHeight: availableHeight }));
    if (sidebar) regions.push(...extractPreviewRegions(sidebar.layout, { labels, pageOffset, offsetX: sidebarX, offsetY: margin, clipWidth: sideWidth, clipHeight: availableHeight }));
    if (main) fields.push(...extractPreviewFields(main.layout, { labels: fieldLabels, richFields, pageOffset, offsetX: mainX, offsetY: margin, clipWidth: mainWidth, clipHeight: availableHeight }));
    if (sidebar) fields.push(...extractPreviewFields(sidebar.layout, { labels: fieldLabels, richFields, pageOffset, offsetX: sidebarX, offsetY: margin, clipWidth: sideWidth, clipHeight: availableHeight }));
    for (let i = 0; i < pages; i++) {
      const page = output.addPage([A4.width, A4.height]);
      if (firstBody && i === 0 && !headerSeparate && header) await embed(header.document.getPage(0), page, 0, 0);
      const design = templateDesign(resume.appearance.templateId);
      if (isDouble && design.sideTint) page.drawRectangle({ x: sidebarX - 5, y: margin + footer, width: sideWidth + 10, height: availableHeight - (i === 0 ? reserve : 0), color: color(resume.appearance.themeColor), opacity: resume.appearance.templateId === 'leafish' ? .105 : .065 });
      if (isDouble && design.sideDivider) page.drawLine({ start: { x: resume.layout.sidebarSide === 'left' ? mainX - gap / 2 : sidebarX - gap / 2, y: margin + footer }, end: { x: resume.layout.sidebarSide === 'left' ? mainX - gap / 2 : sidebarX - gap / 2, y: A4.height - margin - (i === 0 ? reserve : 0) }, thickness: .65, color: color(tint(resume.appearance.themeColor, .7)) });
      if (main && i < main.document.getPageCount()) await embed(main.document.getPage(i), page, mainX, margin + footer);
      if (sidebar && i < sidebar.document.getPageCount()) await embed(sidebar.document.getPage(i), page, sidebarX, margin + footer);
    }
    firstBody = false;
  }
  if (!groups.length && !headerSeparate) { const page = output.addPage([A4.width, A4.height]); if (header) await embed(header.document.getPage(0), page, 0, 0); }
  if (!output.getPageCount()) output.addPage([A4.width, A4.height]);
  if (resume.appearance.pageNumbers) {
    const footerFont = await output.embedFont(StandardFonts.Helvetica);
    output.getPages().forEach((page, index) => { const label = String(index + 1); if (templateDesign(resume.appearance.templateId).classic) page.drawLine({ start: { x: margin, y: footerY + 11 }, end: { x: A4.width - margin, y: footerY + 11 }, thickness: .7, color: color(tint(context.theme, .7)) }); page.drawText(label, { font: footerFont, size: 8, x: (A4.width - footerFont.widthOfTextAtSize(label, 8)) / 2, y: footerY, color: rgb(.4, .45, .42) }); });
  }
  await checkpoint();
  return { bytes: await output.save(), pages: output.getPageCount(), regions, fields };
}
