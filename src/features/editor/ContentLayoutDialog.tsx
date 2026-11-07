import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Italic, RotateCcw, Underline } from 'lucide-react';
import type { ContentFieldLayout, Section, SectionContentLayout, TextAlignment } from '../../domain/types';
import { contentFieldRows, contentFieldSpecs, contentLayoutRows, defaultContentLayout, resolveContentLayout, type ContentFieldSpec } from '../../domain/contentLayout';
import { sectionTitle } from '../../domain/registry';
import { useApp } from '../../app/store';
import { Button, Field, IconButton, Modal, Toggle } from '../../components/ui';
import { contentFontSize } from '../../rendering/contentLayoutView';
import { customFieldSize, FIELD_FONT_RATIO_MIN, FIELD_FONT_RATIO_MAX, resetFieldFontSizes } from '../../domain/typographyBinding';
import { usePreviewFont } from '../preview/usePreviewFont';
import { alignPreviewField, alignmentLabels } from '../../domain/fieldAlignment';
import './content-layout.css';

const fieldTypes = { text: '文字', url: '链接', rich: '正文', tags: '关键词', level: '等级' };
const sizeLabel = (size: number) => String(Number(size.toFixed(2)));

function LayoutField({ field, spec, first, last, afterRich, prefix, pageFontSizePx, onChange, onMove }: { field: ContentFieldLayout; spec: ContentFieldSpec; first: boolean; last: boolean; afterRich: boolean; prefix: string; pageFontSizePx: number; onChange: (patch: Partial<ContentFieldLayout>) => void; onMove: (direction: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  const inheritedSize = contentFontSize({ ...field, fontSizePx: undefined, fontSizeRatio: undefined }, pageFontSizePx, spec);
  const currentSize = contentFontSize(field, pageFontSizePx, spec);
  const [sizeText, setSizeText] = useState(sizeLabel(currentSize));
  useEffect(() => { setSizeText(sizeLabel(currentSize)); }, [currentSize]);
  const changeSize = (text: string) => setSizeText(text);
  const finishSize = () => {
    if (sizeText === '') { setSizeText(sizeLabel(inheritedSize)); onChange({ fontSizePx: undefined, fontSizeRatio: undefined }); return; }
    if (Number(sizeText) === Number(sizeLabel(currentSize))) { setSizeText(sizeLabel(currentSize)); return; }
    const number = Number(sizeText), value = Number.isFinite(number) ? Math.max(pageFontSizePx * FIELD_FONT_RATIO_MIN, Math.min(pageFontSizePx * FIELD_FONT_RATIO_MAX, number)) : currentSize;
    setSizeText(sizeLabel(value)); onChange({ fontSizePx: undefined, fontSizeRatio: value / pageFontSizePx });
  };
  const rich = spec.type === 'rich';
  const separate = first || rich || afterRich;
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }} className={`content-layout-field ${field.visible ? '' : 'field-hidden'}`} data-layout-field-key={field.key}>
    <button type="button" className="drag-handle" aria-label={`拖动排版字段 ${spec.label}`} title="拖动字段排序" {...attributes} {...listeners}><GripVertical size={16} /></button>
    <div className="content-layout-field-name"><strong>{spec.label || '未命名字段'}</strong><small>{rich ? '独占一行，保留正文格式' : fieldTypes[spec.type]}</small></div>
    <Field label="换行" htmlFor={`${prefix}-line`}><select id={`${prefix}-line`} aria-label={`${spec.label}换行方式`} value={separate || field.newLine ? 'new' : 'same'} disabled={separate} onChange={event => onChange({ newLine: event.target.value === 'new' })}><option value="new">另起一行</option><option value="same">与上一字段同行</option></select></Field>
    <Field label={rich ? '段落对齐' : '字段内对齐'} htmlFor={`${prefix}-align`}><select id={`${prefix}-align`} aria-label={`${spec.label}对齐方式`} value={rich ? field.paragraphAlign ?? 'inherit' : field.align} onChange={event => onChange(rich ? { paragraphAlign: event.target.value === 'inherit' ? undefined : event.target.value as TextAlignment } : { align: event.target.value as TextAlignment, inline: false })}>{rich && <option value="inherit">保留正文格式</option>}<option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></Field>
    <Field label="文字" htmlFor={`${prefix}-emphasis`}><select id={`${prefix}-emphasis`} aria-label={`${spec.label}文字样式`} value={field.emphasis} disabled={rich} onChange={event => onChange({ emphasis: event.target.value as ContentFieldLayout['emphasis'] })}><option value="normal">正常</option><option value="bold">加粗</option><option value="muted">次要</option></select></Field>
    <div className="content-layout-visible"><span>显示</span><Toggle checked={field.visible} label={`显示${spec.label}字段`} onChange={visible => onChange({ visible })} /></div>
    <div className="content-layout-move"><IconButton label={`上移${spec.label}字段`} disabled={first} onClick={() => onMove(-1)}><ArrowUp size={13} /></IconButton><IconButton label={`下移${spec.label}字段`} disabled={last} onClick={() => onMove(1)}><ArrowDown size={13} /></IconButton></div>
    <div className="content-layout-typography"><Field label="当前字号（px）" htmlFor={`${prefix}-font-size`}><input id={`${prefix}-font-size`} type="number" min={pageFontSizePx * FIELD_FONT_RATIO_MIN} max={pageFontSizePx * FIELD_FONT_RATIO_MAX} step="any" aria-label={`${spec.label}字号`} value={sizeText} onChange={event => changeSize(event.currentTarget.value)} onBlur={finishSize} /></Field><div className="content-layout-decoration" role="group" aria-label={`${spec.label}格式`}><button type="button" aria-label={`${spec.label}斜体`} aria-pressed={Boolean(field.italic)} onClick={() => onChange({ italic: !field.italic })}><Italic size={14} />斜体</button><button type="button" aria-label={`${spec.label}下划线`} aria-pressed={Boolean(field.underline)} onClick={() => onChange({ underline: !field.underline })}><Underline size={14} />下划线</button></div><small>{spec.primary ? '条目标题' : '正文'} · 页面字号的 {sizeLabel(currentSize / pageFontSizePx * 100)}%{field.fontSizePx !== undefined ? ' · 旧版自定义值' : ''}</small>{customFieldSize(field) && <button type="button" className="text-button content-layout-inherit" aria-label={`${spec.label}字号跟随页面`} onClick={() => { setSizeText(sizeLabel(inheritedSize)); onChange({ fontSizePx: undefined, fontSizeRatio: undefined }); }}>恢复层级 · {sizeLabel(inheritedSize)}px</button>}</div>
  </div>;
}

export function ContentLayoutDialog({ section, pageFontSizePx, fontFamilyId = 'noto-sans-sc', open, onClose }: { section: Section; pageFontSizePx: number; fontFamilyId?: string; open: boolean; onClose: () => void }) {
  const update = useApp(state => state.update);
  const [draft, setDraft] = useState<SectionContentLayout>(() => resolveContentLayout(section));
  const [templateMode, setTemplateMode] = useState(!section.contentLayout);
  useEffect(() => { if (open) { setDraft(resolveContentLayout(section)); setTemplateMode(!section.contentLayout); } }, [open, section.id]);
  const title = sectionTitle(section) || '未命名模块';
  const specs = new Map(contentFieldSpecs(section).map(field => [field.key, field]));
  const sampleFont = usePreviewFont(fontFamilyId, [...specs.values()].map(field => field.label).join(''), open, draft.fields.some(field => field.visible && field.italic));
  const resolved = resolveContentLayout({ ...section, contentLayout: draft });
  const rows = contentLayoutRows({ ...section, contentLayout: resolved });
  const fullRows = contentFieldRows(resolved.fields, new Set([...specs.values()].filter(spec => spec.type === 'rich').map(spec => spec.key)));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const patch = (key: string, changes: Partial<ContentFieldLayout>) => { setTemplateMode(false); setDraft(current => { const next = resolveContentLayout({ ...section, contentLayout: current }); next.fields = next.fields.map(field => field.key === key ? { ...field, ...changes } : field); return next; }); };
  const move = (from: number, to: number) => { if (from < 0 || from >= resolved.fields.length || to < 0 || to >= resolved.fields.length || from === to) return; setTemplateMode(false); setDraft(current => { const next = resolveContentLayout({ ...section, contentLayout: current }); next.fields = arrayMove(next.fields, from, to); return next; }); };
  const setGap = (key: 'rowGapPx' | 'itemGapPx', value: number) => { if (!Number.isFinite(value)) return; setTemplateMode(false); setDraft(current => ({ ...current, [key]: Math.max(0, Math.min(key === 'rowGapPx' ? 24 : 48, value)) })); };
  const alignRows = (key: string, scope: 'row' | 'module', value: string) => {
    setTemplateMode(false);
    setDraft(current => alignPreviewField({ ...section, contentLayout: current }, key, scope, value === 'inherit' ? null : value as TextAlignment) ?? current);
  };
  const apply = () => {
    update(next => { const current = next.sections.find(item => item.id === section.id); if (!current) return; if (templateMode) delete current.contentLayout; else current.contentLayout = resolveContentLayout({ ...current, contentLayout: structuredClone(resolved) }); });
    useApp.getState().notify({ message: templateMode ? `${title}已恢复模板排版` : `${title}的内部排版已应用` });
    onClose(); void useApp.getState().flush();
  };
  return <Modal open={open} onClose={onClose} title={`${title} · 模块内排版`} description="调整字段的顺序、同行和对齐方式。本模块的所有条目共用此排版，填写的内容会保留。" wide>
    <div className="modal-body content-layout-body">
      <div className="content-layout-intro"><strong>字段排列</strong><span>{templateMode ? '模板排版方案' : '自定义方案'}</span></div>
      <p className="content-layout-help">页面正文基准为 {pageFontSizePx}px，条目标题按 18 / 14 倍显示。修改字段字号会保存相对比例，之后随页面字号一起缩放。</p>
      <div className="content-layout-row-default"><Field label="本模块各行对齐" htmlFor={`content-layout-${section.id}-default-align`}><select id={`content-layout-${section.id}-default-align`} value={resolved.rowAlign ?? 'inherit'} disabled={!resolved.fields.some(field => field.visible)} onChange={event => alignRows(resolved.fields.find(field => field.visible)!.key, 'module', event.target.value)}><option value="inherit">沿用模板</option>{Object.entries(alignmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><small>各行作为一组相对所属栏对齐。设置模块默认会清除单独的行对齐；下方可再调整某一行。</small></div>
      <div className="content-layout-size-reset"><span>{resolved.fields.filter(customFieldSize).length ? `${resolved.fields.filter(customFieldSize).length} 个字段使用自定义字号比例` : '所有字段跟随统一字号层级'}</span><button type="button" className="text-button" disabled={!resolved.fields.some(customFieldSize)} onClick={() => { setDraft(resetFieldFontSizes(resolved)); setTemplateMode(false); }}>统一本模块字号</button></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; move(resolved.fields.findIndex(field => field.key === active.id), resolved.fields.findIndex(field => field.key === over.id)); }}>
        <SortableContext items={resolved.fields.map(field => field.key)} strategy={verticalListSortingStrategy}><div className="content-layout-fields">{resolved.fields.map((field, index) => <LayoutField key={field.key} field={field} spec={specs.get(field.key)!} first={index === 0} last={index === resolved.fields.length - 1} afterRich={specs.get(resolved.fields[index - 1]?.key)?.type === 'rich'} prefix={`content-layout-${section.id}-${field.key}`} pageFontSizePx={pageFontSizePx} onChange={changes => patch(field.key, changes)} onMove={direction => move(index, index + direction)} />)}</div></SortableContext>
      </DndContext>
      {resolved.fields.length === 0 && <p className="content-layout-help">先在模块中添加可显示的字段。</p>}
      <div className="content-layout-spacing"><Field label="行间距（px）" htmlFor={`content-layout-${section.id}-row-gap`}><input id={`content-layout-${section.id}-row-gap`} type="number" min={0} max={24} step={1} value={resolved.rowGapPx} onChange={event => setGap('rowGapPx', event.currentTarget.valueAsNumber)} /></Field><Field label="条目间距（px）" htmlFor={`content-layout-${section.id}-item-gap`}><input id={`content-layout-${section.id}-item-gap`} type="number" min={0} max={48} step={1} value={resolved.itemGapPx} onChange={event => setGap('itemGapPx', event.currentTarget.valueAsNumber)} /></Field></div>
      <section className="content-layout-preview" aria-label="字段排列示意"><h3>字段排列示意</h3><div className="content-layout-sketch" style={{ gap: resolved.rowGapPx, fontFamily: sampleFont }}>{rows.map((row, index) => {
        const fullRow = fullRows.find(fields => fields.some(field => field.key === row[0].key));
        const ownAlign = fullRow?.find(field => field.rowAlign)?.rowAlign;
        const align = row[0]?.rowAlign;
        const richRow = row.some(field => specs.get(field.key)?.type === 'rich');
        return <div className="content-layout-sketch-group" key={index}><label>第 {index + 1} 行<select aria-label={`第${index + 1}行对齐方式`} value={ownAlign ?? 'inherit'} onChange={event => alignRows(row[0].key, 'row', event.target.value)}><option value="inherit">跟随模块</option>{Object.entries(alignmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="content-layout-sketch-row" data-layout-row={index + 1} style={{ justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : undefined }}>{row.map(field => <span key={field.key} className={`layout-emphasis-${field.emphasis}`} style={{ flex: align && !richRow && field.inline !== false ? '0 1 auto' : undefined, textAlign: specs.get(field.key)?.type === 'rich' ? field.paragraphAlign ?? align ?? 'left' : field.align, fontSize: contentFontSize(field, pageFontSizePx, specs.get(field.key)), fontStyle: field.italic ? 'italic' : undefined, textDecoration: field.underline ? 'underline' : undefined }}>{specs.get(field.key)?.label || '未命名字段'}</span>)}</div></div>;
      })}{rows.length === 0 && <p>所有字段均已隐藏，原始内容仍会保留。</p>}</div><small>字号和字体与纸张一致，排列仅为示意。正文局部格式在简历预览中显示。</small></section>
    </div>
    <div className="content-layout-footer"><Button secondary onClick={() => { setDraft(defaultContentLayout(section)); setTemplateMode(true); }}><RotateCcw size={14} />恢复模板排版</Button><div className="content-layout-actions"><Button secondary onClick={onClose}>取消</Button><Button onClick={apply}>应用排版</Button></div></div>
  </Modal>;
}
