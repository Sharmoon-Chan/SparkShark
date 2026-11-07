import type { PreparedAsset, Resume, RichNode, Section } from '../domain/types';
import { hasContent, parseResume, richText, safeLink } from '../domain/resume';
import { sectionTitle } from '../domain/registry';
import { basicsView, compactItemView, inlineBasicsView, primaryKeyFor, visiblePageGroups } from './viewModel';
import { previewFieldId } from './previewFields';
import { readableThemeColor } from './colors';
import { resolveContentLayout } from '../domain/contentLayout';
import { contentFontSize, moduleContentRows, type ContentCell } from './contentLayoutView';
import { avatarFrame } from '../domain/avatar';
import { fontOptionFor } from '../domain/fonts';
import { RESUME_TYPE_SCALE } from '../domain/typography';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function linked(value: string, href?: string | null): string {
  return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(value)}</a>` : escapeHtml(value);
}

export function richHtml(node: RichNode): string {
  if (node.type === 'text') {
    let value = escapeHtml(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        const href = safeLink(mark.attrs.href);
        if (href) value = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${value}</a>`;
      } else {
        const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', highlight: 'mark' }[mark.type];
        value = `<${tag}>${value}</${tag}>`;
      }
    }
    return value;
  }
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'codeBlock') return `<pre><code>${escapeHtml(richText(node))}</code></pre>`;
  const content = (node.content ?? []).map(richHtml).join('');
  if (node.type === 'doc') return content;
  if (node.type === 'bulletList') return `<ul>${content}</ul>`;
  if (node.type === 'orderedList') return `<ol start="${node.attrs?.start ?? 1}">${content}</ol>`;
  if (node.type === 'listItem') return `<li>${content}</li>`;
  const tag = node.type === 'heading' ? `h${(node.attrs?.level ?? 3) + 2}` : 'p';
  const alignment = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : '';
  return `<${tag}${alignment}>${content}</${tag}>`;
}

function fieldMarker(enabled: boolean, sectionId: string, itemId: string, key: string): string {
  return enabled ? ` data-preview-field-id="${escapeHtml(previewFieldId(sectionId, itemId, key))}"` : '';
}
function configuredSectionHtml(section: Section, resume: Resume, markers: boolean): string {
  const settings = resolveContentLayout(section), title = sectionTitle(section, resume.locale);
  const entries = section.kind === 'summary' ? [{ id: section.id, rows: moduleContentRows(section) }] : section.items.filter(item => item.visible).map(item => ({ id: item.id, rows: moduleContentRows(section, item) })).filter(entry => entry.rows.length > 0);
  if (!entries.some(entry => entry.rows.length > 0)) return '';
  const cellHtml = (cell: ContentCell, inlineRow: boolean, itemId: string) => {
    const { layout } = cell;
    const natural = inlineRow && cell.spec.type !== 'level' && (layout.inline || layout.align === 'right');
    const fontSize = `${contentFontSize(layout, resume.appearance.fontSizePx, cell.spec)}px`;
    const typography = `font-size:${fontSize};font-style:${layout.italic ? 'italic' : 'normal'};text-decoration:${layout.underline ? 'underline' : 'none'};`;
    const style = cell.rich ? `flex:1;min-width:0;${typography}` : `flex:${natural ? '0 1 auto' : '1'};min-width:0;max-width:100%;${natural && layout.align === 'right' ? 'margin-left:auto;' : ''}text-align:${layout.align};${typography}font-weight:${layout.emphasis === 'bold' ? 700 : 400};${layout.emphasis === 'muted' ? 'color:#59635d;' : ''}`;
    const levelStyle = `margin-left:${layout.align === 'left' ? '0' : 'auto'};margin-right:${layout.align === 'right' ? '0' : 'auto'}`;
    const body = cell.rich ? richHtml(cell.rich) : cell.spec.type === 'level' && typeof cell.value === 'number' && resume.layout.mode === 'double' ? `<div class="level" role="img" aria-label="${escapeHtml(cell.text)}" style="${levelStyle}"><span style="width:${cell.value * 20}%"></span></div>` : linked(cell.text, cell.href);
    return `<div class="content-layout-field${cell.rich ? ' content-layout-rich' : ''}" data-field-key="${escapeHtml(layout.key)}"${fieldMarker(markers, section.id, itemId, layout.key)} style="${style}">${body}</div>`;
  };
  const items = entries.map(({ rows, id }, index) => {
    const richIndex = rows.findIndex(row => row.some(cell => cell.rich)), headerCount = richIndex < 0 ? rows.length : richIndex;
    const rowHtml = (row: ContentCell[], i: number) => { const inline = !row.some(cell => cell.rich) && row.some(cell => cell.layout.inline); return `<div class="content-layout-row${row.some(cell => cell.rich) ? ' has-rich' : ''}" style="margin-bottom:${i < rows.length - 1 ? settings.rowGapPx : 0}px;${inline ? 'flex-wrap:wrap;' : ''}">${row.map(cell => cellHtml(cell, inline, id)).join('')}</div>`; };
    const heading = index === 0 && title ? `<h2>${escapeHtml(title)}</h2>` : '';
    return `<div class="resume-item content-layout-item" style="margin-bottom:${settings.itemGapPx}px"><div class="item-header">${heading}${rows.slice(0, headerCount).map(rowHtml).join('')}</div>${rows.slice(headerCount).map((row, i) => rowHtml(row, i + headerCount)).join('')}</div>`;
  }).join('');
  return `<section class="resume-section" id="${escapeHtml(section.id)}">${items}</section>`;
}

function sectionHtml(section: Section, resume: Resume, markers: boolean): string {
  if (section.contentLayout) return configuredSectionHtml(section, resume, markers);
  const marked = (itemId: string, key: string, html: string) => markers ? `<span${fieldMarker(true, section.id, itemId, key)} style="display:contents">${html}</span>` : html;
  const markedRich = (itemId: string, key: string, node: RichNode) => !markers ? richHtml(node) : (node.content ?? []).map(child => richHtml(child).replace(/^<([a-z][a-z0-9]*)\b/i, `<$1${fieldMarker(true, section.id, itemId, key)}`)).join('');
  const title = sectionTitle(section, resume.locale);
  const heading = title ? `<h2>${escapeHtml(title)}</h2>` : '';
  let outsideHeading = heading;
  let content: string;
  if (section.kind === 'summary') content = markedRich(section.id, 'summary', section.content);
  else if (section.kind === 'custom') content = section.items.filter(item => item.visible && Object.values(item.values).some(hasContent)).map(item => {
    const fields = section.fieldDefinitions.filter(field => field.visible && hasContent(item.values[field.id]));
    return `<div class="resume-item">${fields.map(field => {
      const value = item.values[field.id];
      if (value && typeof value === 'object' && !Array.isArray(value)) return markedRich(item.id, field.id, value);
      const text = Array.isArray(value) ? value.join(' · ') : String(value);
      const body = field.type === 'url' ? linked(text, safeLink(text)) : escapeHtml(text);
      return `<p${field.type === 'name' ? ' class="item-name"' : ''}${fieldMarker(markers, section.id, item.id, field.id)}>${body}</p>`;
    }).join('')}</div>`;
  }).join('');
  else {
    outsideHeading = '';
    content = section.items.filter(item => item.visible && Object.values(item.fields).some(hasContent)).map((item, index) => {
      const view = compactItemView(section.kind, item);
      const single = resume.layout.mode === 'single';
      const rightLabel = view.date || (single && view.level !== null ? `${view.level} / 5` : '');
      const summary = view.summary && hasContent(view.summary) ? view.summary : null;
      const short = (!summary || richText(summary).length <= 180) && (view.primary + view.date + view.caption + view.links.map(link => link.value).join('')).length <= 800;
      const itemHeading = view.primary || rightLabel ? `<div class="item-heading">${view.primary ? `<h3 class="item-name"${fieldMarker(markers, section.id, item.id, primaryKeyFor(section.kind))}>${escapeHtml(view.primary)}</h3>` : ''}${rightLabel ? `<p class="item-date"${fieldMarker(markers, section.id, item.id, view.date ? 'dateText' : 'level')}>${escapeHtml(rightLabel)}</p>` : ''}</div>` : '';
      const classicCaption = resume.appearance.templateId === 'essential' && (section.kind === 'work' || section.kind === 'internships');
      const captionFields = [...view.details.filter(field => field.key !== 'dateText'), ...(view.keywords.length ? [{ key: 'keywords', value: view.keywords.join(' · ') }] : [])];
      const captionText = (fields: { key: string; value: string }[]) => fields.map(field => marked(item.id, field.key, escapeHtml(field.value))).join(' · ');
      const leftCaption = captionText(captionFields.filter(field => field.key !== 'location'));
      const location = view.details.find(field => field.key === 'location')?.value ?? '';
      const caption = !view.caption ? '' : classicCaption ? `<div class="item-detail item-detail-row"><span>${leftCaption}</span><span${fieldMarker(markers && Boolean(location), section.id, item.id, 'location')}>${escapeHtml(location)}</span></div>` : `<p class="item-detail">${captionText(captionFields)}</p>`;
      return `<div class="resume-item${short ? ' short-item' : ''}${section.kind === 'skills' ? ' skill-item' : ''}"><div class="item-header">${index === 0 ? heading : ''}${itemHeading}${caption}${view.links.map(link => `<p class="item-link"${fieldMarker(markers, section.id, item.id, link.key)}>${linked(link.value, link.href)}</p>`).join('')}${!single && view.level !== null ? `<div class="level" role="img" aria-label="${view.level} / 5"${fieldMarker(markers, section.id, item.id, 'level')}><span style="width:${view.level * 20}%"></span></div>` : ''}</div>${summary ? markedRich(item.id, 'summary', summary) : ''}</div>`;
    }).join('');
  }
  return `<section class="resume-section" id="${escapeHtml(section.id)}">${outsideHeading}${content}</section>`;
}

function imageData(asset: PreparedAsset): string {
  let binary = '';
  for (let i = 0; i < asset.data.length; i += 32768) binary += String.fromCharCode(...asset.data.subarray(i, i + 32768));
  return `data:${asset.mime};base64,${btoa(binary)}`;
}

/** A self-contained reading copy. Logical page groups retain the editor's section order. */
export function renderResumeHtml(input: Resume, assets: Record<string, PreparedAsset> = {}, options: { fieldMarkers?: boolean } = {}): string {
  const resume = parseResume(input), { basics } = resume, style = { ...resume.appearance, avatar: avatarFrame(resume.appearance.avatar), themeColor: readableThemeColor(resume.appearance.themeColor) };
  const spacing = style.spacingScale ?? 1;
  const view = basicsView(basics), groups = visiblePageGroups(resume);
  const photo = basics.avatarAssetId && style.avatar.visible ? assets[basics.avatarAssetId] : undefined;
  const symbols = { location: '⌖', phone: '☎', mail: '✉', globe: '◎' };
  const hasBasics = basics.name || basics.headline || view.contacts.length || view.customFields.length || photo;
  const contactHtml = style.templateId === 'essential' ? `<div class="contacts">${inlineBasicsView(basics).map(contact => `<span class="contact">${linked(contact.text, contact.href)}</span>`).join('')}</div>` : `${view.contacts.length ? `<div class="contacts">${view.contacts.map(contact => `<span class="contact">${style.hideIcons ? '' : `<span class="contact-icon" aria-hidden="true">${symbols[contact.icon]}</span>`}${linked(contact.value, contact.href)}</span>`).join('')}</div>` : ''}${view.customFields.map(field => `<p class="custom-contact">${escapeHtml((field.label ? field.label + '：' : '') + field.value)}</p>`).join('')}`;
  const header = hasBasics ? `<header class="resume-header">${photo ? `<img class="avatar" src="${imageData(photo)}" alt="${escapeHtml(basics.name || '头像')}">` : ''}<div class="header-text">${basics.name ? `<h1>${escapeHtml(basics.name)}</h1>` : ''}${basics.headline ? `<p class="headline">${escapeHtml(basics.headline)}</p>` : ''}${contactHtml}</div></header>` : '';
  const pages = (groups.length ? groups : [{ id: 'blank', main: [], sidebar: [] }]).map((group, index) => {
    const sectionContent = (sections: Section[]) => sections.map(section => sectionHtml(section, resume, Boolean(options.fieldMarkers))).join('');
    const columns = resume.layout.mode === 'double'
      ? `<div class="columns"><div class="main-column">${sectionContent(group.main)}</div><aside class="sidebar-column">${sectionContent(group.sidebar)}</aside></div>`
      : `<div class="main-column">${sectionContent([...group.main, ...group.sidebar])}</div>`;
    return `<article class="layout-page" aria-label="${index + 1}">${index === 0 ? header : ''}${columns}</article>`;
  }).join('\n');
  const font = fontOptionFor(style.fontFamilyId).cssFamily;
  const ratio = resume.layout.sidebarSide === 'left' ? `${1 - resume.layout.mainRatio}fr ${resume.layout.mainRatio}fr` : `${resume.layout.mainRatio}fr ${1 - resume.layout.mainRatio}fr`;
  return `<!doctype html>
<html lang="${resume.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="SparkShark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(resume.title || basics.name || 'SparkShark')}</title>
<style>
*{box-sizing:border-box}html{background:#eef1ef}body{margin:0;color:#27312b;font-family:${font};font-size:${style.fontSizePx}px;line-height:${style.lineHeight};overflow-wrap:anywhere}p,h1,h2,h3,h4,h5,ul,ol,pre{margin:0}a{color:var(--theme);text-decoration:${style.underlineLinks ? 'underline' : 'none'}}.resume{--theme:${style.themeColor};max-width:794px;margin:28px auto}.layout-page{background:#fff;min-height:1123px;padding:${style.marginPx}px;margin-bottom:24px;box-shadow:0 3px 24px #243c2d12}.resume-header{display:flex;align-items:flex-start;gap:17px;padding-bottom:19px}.header-text{flex:1;min-width:0}h1{font-size:2.1em;line-height:1.15;color:var(--theme);margin-bottom:4px}.headline{font-size:1.06em;margin-bottom:7px}.contacts{display:flex;flex-wrap:wrap;column-gap:14px;row-gap:4px;font-size:1em;color:#4c5650}.contacts a{color:inherit}.contact{display:inline-flex;align-items:baseline;gap:4px;min-width:0;max-width:100%}.contact-icon{color:#616b66}.custom-contact{font-size:1em;color:#4c5650;margin-top:3px}.avatar{width:${style.avatar.widthPx}px;height:${style.avatar.widthPx / style.avatar.aspectRatio}px;border-radius:${style.avatar.radiusPx}px;border:${style.avatar.borderWidthPx}px solid ${style.avatar.borderColor};object-fit:cover;flex-shrink:0;max-width:38%}.columns{display:grid;grid-template-columns:${ratio};gap:${style.columnGapPx}px;align-items:start}.main-column,.sidebar-column{min-width:0;grid-row:1}.main-column{grid-column:${resume.layout.sidebarSide === 'left' ? 2 : 1}}.sidebar-column{grid-column:${resume.layout.sidebarSide === 'left' ? 1 : 2}}.resume-section{margin-bottom:.95em}.resume-section>h2{font-size:${RESUME_TYPE_SCALE.section}em;font-weight:700;color:var(--theme);margin-bottom:8px}.resume-section p{white-space:pre-wrap;margin-bottom:.35em}.resume-item{margin-bottom:.6em}.item-name{font-size:${RESUME_TYPE_SCALE.entry}em;font-weight:700;margin-bottom:3px}.item-detail{font-size:1em;color:#59635d}.item-link{font-size:1em}.keywords{font-size:1em;color:#5d6861}.level{height:4px;width:55%;background:#e6eae7;margin:4px 0 6px}.level>span{display:block;height:100%;background:var(--theme)}.resume-section h3:not(.item-name){font-size:1.5em}.resume-section h4{font-size:1.25em}.resume-section h5{font-size:1.1em}.resume-section h3:not(.item-name),.resume-section h4,.resume-section h5{margin-bottom:.35em}.resume-section ul,.resume-section ol{padding-left:1.7em;margin-bottom:.3em}.resume-section li>p{margin-bottom:3px}mark{background:#fef08a}pre{background:#f4f5f6;padding:7px;white-space:pre-wrap;margin-bottom:7px}code{font-family:Consolas,monospace}.template-clean .resume-section>h2{color:#222d26}.template-lined .resume-section>h2{border-bottom:1px solid #cbd8d0;padding-bottom:4px}.template-band .sidebar-column{background:color-mix(in srgb,var(--theme) 7%,white);padding:9px;border-radius:3px}
.resume-section h2{font-size:${RESUME_TYPE_SCALE.section}em;font-weight:700;color:var(--theme);margin-bottom:4px}.template-clean .resume-section h2{color:#222d26}.template-lined .resume-section h2{border-bottom:1px solid #cbd8d0;padding-bottom:.667px}.item-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.item-heading .item-name{flex:1;min-width:0}.item-heading .item-date{max-width:46%;flex-shrink:0;text-align:right;font-size:1em;color:#59635d}.item-header{break-inside:avoid}.short-item{break-inside:avoid}.resume-section h2{break-after:avoid}
@media(max-width:650px){.resume{margin:0}.layout-page{min-height:0;box-shadow:none;margin-bottom:12px;padding:20px}.columns{display:flex;flex-direction:column;gap:0}.main-column,.sidebar-column{width:100%}.sidebar-column{order:2}.resume-header{gap:12px}.avatar{max-width:30%;height:auto;aspect-ratio:${style.avatar.aspectRatio}}}
@media print{html{background:#fff}.resume{max-width:none;margin:0}.layout-page{min-height:0;margin:0;padding:0;box-shadow:none;break-after:page}.layout-page:last-child{break-after:auto}.resume-section>h2,.item-name{break-after:avoid}a{color:inherit}body{print-color-adjust:exact}}
@page{size:A4;margin:${(style.marginPx * 25.4 / 96).toFixed(3)}mm}
.skill-item{margin-bottom:.25em}.skill-item .item-detail{margin-bottom:2px}.skill-item .level{margin:3px 0 3px}
.content-layout-row{display:flex;align-items:flex-start;gap:8px;break-inside:avoid}.content-layout-row.has-rich{break-inside:auto}.content-layout-field{white-space:pre-wrap;overflow-wrap:anywhere}.content-layout-rich{white-space:normal}.content-layout-rich p{white-space:pre-wrap}
.template-essential{color:#0f172a}.template-essential .resume-header{flex-direction:row-reverse;align-items:flex-start;text-align:left;border:0;padding-top:0;padding-bottom:19px;margin:0}.template-essential .contacts{justify-content:flex-start;column-gap:0}.template-essential .contact{border-right:.667px solid #cbd5e1;padding-right:9.333px;margin-right:9.333px}.template-essential .contact:last-child{border-right:0;padding-right:0;margin-right:0}.template-essential h1{font-size:2.1em;color:#0f172a;margin-bottom:4px}.template-essential .resume-section h2{color:#1e293b;background:color-mix(in srgb,var(--theme) 30%,white);font-size:${RESUME_TYPE_SCALE.section}em;font-weight:600;line-height:1.428571;padding:4px 0 4px 8px;margin-bottom:6.667px;border:0;border-radius:0}.template-essential .item-detail-row{display:flex;justify-content:space-between;gap:10.667px;color:#64748b}.template-essential .item-detail-row>span:first-child{flex:1}.template-essential .item-detail-row>span:last-child{max-width:46%;text-align:right}
.template-modern .resume-header{flex-direction:row-reverse;border-top:4px solid var(--theme);border-bottom:1px solid var(--theme);padding-top:12px;padding-bottom:12px;margin-bottom:19px}.template-modern .resume-section h2,.template-reed .resume-section h2{border-left:3.333px solid var(--theme);padding-left:9.333px;margin-bottom:7px}
.template-modernSplit .resume-header{flex-direction:row-reverse;background:color-mix(in srgb,var(--theme) 35%,#000);padding:17px;margin-bottom:19px}.template-modernSplit h1,.template-modernSplit .headline{color:#fff}.template-modernSplit .contacts,.template-modernSplit .custom-contact,.template-modernSplit .contact-icon{color:#e2e8f0}.template-modernSplit .resume-section h2{border-bottom:1px solid #cbd8d0;padding-bottom:1px}
.template-gradient .resume-header{background:color-mix(in srgb,var(--theme) 9%,white);border-top:5px solid;border-image:linear-gradient(to right,var(--theme),color-mix(in srgb,var(--theme) 20%,white)) 1;padding:17px;border-radius:9px;margin-bottom:19px}.template-gradient .resume-section h2,.template-leafish .resume-section h2{background:color-mix(in srgb,var(--theme) 9%,white);padding:4px 9.333px;margin-bottom:7px}.template-leafish .resume-section h2{border-radius:7px}
.template-reed .resume-header{flex-direction:row-reverse;border-bottom:2px solid var(--theme);padding:12px 0;margin-bottom:19px}.template-reed h1{font-size:2.65em}.template-reed .resume-section h2{font-size:${RESUME_TYPE_SCALE.section}em}
.template-leafish .sidebar-column{background:color-mix(in srgb,var(--theme) 10.5%,white);padding:7px;border-radius:5px}.template-modernSplit .sidebar-column,.template-gradient .sidebar-column{position:relative}.template-modernSplit .sidebar-column:before,.template-gradient .sidebar-column:before{content:"";position:absolute;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--theme) 30%,white);${resume.layout.sidebarSide === 'left' ? `right:${-style.columnGapPx / 2}px` : `left:${-style.columnGapPx / 2}px`}}
@media(max-width:650px){.template-modernSplit .sidebar-column:before,.template-gradient .sidebar-column:before{display:none}.template-modern .resume-header,.template-reed .resume-header{gap:12px}}
.resume-section{margin-bottom:${spacing * .95}em}.resume-item{margin-bottom:${spacing * .6}em}.skill-item{margin-bottom:${spacing * .25}em}.resume-section p{margin-bottom:${spacing * .35}em}.resume-section ul,.resume-section ol{margin-bottom:${spacing * .3}em}.resume-section li>p{margin-bottom:${spacing * 3}px}pre{padding:${spacing * 7}px;margin-bottom:${spacing * 7}px}.resume-section h3:not(.item-name),.resume-section h4,.resume-section h5{margin-bottom:${spacing * .35}em}.resume-header{padding-bottom:${spacing * 19}px}h1{margin-bottom:${spacing * 4}px}.headline{margin-bottom:${spacing * 7}px}.contacts{row-gap:${spacing * 4}px}.custom-contact{margin-top:${spacing * 3}px}.level{margin:${spacing * 4}px 0 ${spacing * 6}px}.skill-item .level{margin:${spacing * 3}px 0}.skill-item .item-detail{margin-bottom:${spacing * 2}px}
.template-essential .resume-header{padding-bottom:${spacing * 19}px}.template-essential .resume-section h2{padding-top:${spacing * 4}px;padding-bottom:${spacing * 4}px;margin-bottom:${spacing * 6.667}px}.template-modern .resume-header,.template-reed .resume-header{padding-top:${spacing * 12}px;padding-bottom:${spacing * 12}px;margin-bottom:${spacing * 19}px}.template-modern .resume-section h2,.template-reed .resume-section h2{margin-bottom:${spacing * 7}px}.template-modernSplit .resume-header,.template-gradient .resume-header{padding-top:${spacing * 17}px;padding-bottom:${spacing * 17}px;margin-bottom:${spacing * 19}px}.template-gradient .resume-section h2,.template-leafish .resume-section h2{padding-top:${spacing * 4}px;padding-bottom:${spacing * 4}px;margin-bottom:${spacing * 7}px}
.headline{font-size:1.4em;font-weight:700;line-height:1.2;color:var(--theme)}.template-modernSplit .headline{color:#fff}
.template-essential .resume-header{align-items:center;justify-content:space-between;gap:0}.template-essential .avatar{flex-shrink:0;margin-right:4px}
.item-header{break-after:avoid}
.template-executive .resume-header{flex-direction:row-reverse;background:color-mix(in srgb,var(--theme) 35%,#000);padding:17.333px;padding-top:${spacing * 17.333}px;padding-bottom:${spacing * 17.333}px;margin-bottom:${spacing * 18.667}px}.template-executive h1,.template-executive .headline{color:#fff}.template-executive .contacts,.template-executive .custom-contact,.template-executive .contact-icon{color:#e2e8f0}.template-executive .resume-section h2{color:#fff;background:var(--theme);padding:${spacing * 4}px 9.333px;margin-bottom:${spacing * 6.667}px}
.template-scholar .resume-header{flex-direction:column;align-items:center;text-align:center;gap:0}.template-scholar .avatar{margin-bottom:${spacing * 10.667}px}.template-scholar .header-text{width:100%}.template-scholar .contacts{justify-content:center}.template-scholar h1,.template-atelier h1{font-size:2.65em}.template-scholar .resume-section h2{font-size:${RESUME_TYPE_SCALE.section}em;border-top:.867px solid var(--theme);border-bottom:.867px solid var(--theme);padding:${spacing * 4}px 0;margin-bottom:${spacing * 6.667}px}
.template-atelier .resume-header{border-left:5.333px solid var(--theme);padding-left:17.333px}.template-atelier .resume-section h2{font-size:${RESUME_TYPE_SCALE.section}em;margin-bottom:${spacing * 6.667}px}.template-atelier .resume-section h2:after{content:"";display:block;width:37.333px;height:2px;margin-top:${spacing * 5.333}px;background:var(--theme)}
.template-ledger .resume-header{flex-direction:row-reverse;border:1px solid var(--theme);padding:17.333px;padding-top:${spacing * 17.333}px;padding-bottom:${spacing * 17.333}px;margin-bottom:${spacing * 18.667}px}.template-ledger .resume-section h2{border:.867px solid var(--theme);padding:${spacing * 4}px 9.333px;margin-bottom:${spacing * 6.667}px}.template-ledger .sidebar-column{position:relative}.template-ledger .sidebar-column:before{content:"";position:absolute;top:0;bottom:0;width:.867px;background:color-mix(in srgb,var(--theme) 30%,white);${resume.layout.sidebarSide === 'left' ? `right:${-style.columnGapPx / 2}px` : `left:${-style.columnGapPx / 2}px`}}
.template-ribbon .resume-header{border-top:4px solid var(--theme);padding-top:${spacing * 12}px}.template-ribbon .resume-section h2{background:color-mix(in srgb,var(--theme) 9%,white);border-left:3.333px solid var(--theme);padding:${spacing * 4}px 0 ${spacing * 4}px 9.333px;margin-bottom:${spacing * 6.667}px}
.template-aurora .resume-header{background:color-mix(in srgb,var(--theme) 9%,white);padding:17.333px;padding-top:${spacing * 17.333}px;padding-bottom:${spacing * 17.333}px;margin-bottom:${spacing * 18.667}px;border-radius:9.333px}.template-aurora .resume-section h2{display:flex;gap:8px;align-items:flex-start}.template-aurora .resume-section h2:before{content:"";flex-shrink:0;width:6.667px;height:6.667px;margin-top:.48em;border-radius:50%;background:var(--theme)}.template-aurora .sidebar-column{position:relative;isolation:isolate}.template-aurora .sidebar-column:before{content:"";position:absolute;inset:0 -6.667px;background:color-mix(in srgb,var(--theme) 6.5%,white);z-index:-1}
@media(max-width:650px){.template-ledger .sidebar-column:before{display:none}.template-scholar .avatar{max-width:30%}}
${spacing > 1 ? '.main-column>.resume-section:last-child,.sidebar-column>.resume-section:last-child{margin-bottom:0}' : ''}
</style>
</head>
<body><main class="resume template-${style.templateId}">${pages}</main></body>
</html>\n`;
}
