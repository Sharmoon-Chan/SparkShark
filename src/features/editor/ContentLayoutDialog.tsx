import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Italic, RotateCcw, Underline } from 'lucide-react';
import type { ContentFieldLayout, Section, SectionContentLayout } from '../../domain/types';
import { contentFieldSpecs, contentLayoutRows, defaultContentLayout, resolveContentLayout, type ContentFieldSpec } from '../../domain/contentLayout';
import { sectionTitle } from '../../domain/registry';
import { useApp } from '../../app/store';
import { Button, Field, IconButton, Modal, Toggle } from '../../components/ui';
import './content-layout.css';

const fieldTypes = { text: '文字', url: '链接', rich: '正文', tags: '关键词', level: '等级' };

function LayoutField({ field, spec, first, last, afterRich, prefix, pageFontSizePx, onChange, onMove }: { field: ContentFieldLayout; spec: ContentFieldSpec; first: boolean; last: boolean; afterRich: boolean; prefix: string; pageFontSizePx: number; onChange: (patch: Partial<ContentFieldLayout>) => void; onMove: (direction: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  const currentSize = field.fontSizePx ?? pageFontSizePx;
  const [sizeText, setSizeText] = useState(String(currentSize));
  useEffect(() => { setSizeText(String(currentSize)); }, [field.fontSizePx, pageFontSizePx]);
  const changeSize = (text: string) => setSizeText(text);
  const finishSize = () => {
    if (sizeText === '') { setSizeText(String(pageFontSizePx)); onChange({ fontSizePx: undefined }); return; }
    if (Number(sizeText) === currentSize) { setSizeText(String(currentSize)); return; }
    const number = Number(sizeText), value = Number.isFinite(number) ? Math.max(8, Math.min(36, number)) : currentSize;
    setSizeText(String(value)); onChange({ fontSizePx: value });
  };
  const rich = spec.type === 'rich';
  const separate = first || rich || afterRich;
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }} className={`content-layout-field ${field.visible ? '' : 'field-hidden'}`} data-layout-field-key={field.key}>
    <button type="button" className="drag-handle" aria-label={`拖动排版字段 ${spec.label}`} title="拖动字段排序" {...attributes} {...listeners}><GripVertical size={16} /></button>
    <div className="content-layout-field-name"><strong>{spec.label || '未命名字段'}</strong><small>{rich ? '独占一行，保留正文格式' : fieldTypes[spec.type]}</small></div>
    <Field label="换行" htmlFor={`${prefix}-line`}><select id={`${prefix}-line`} aria-label={`${spec.label}换行方式`} value={separate || field.newLine ? 'new' : 'same'} disabled={separate} onChange={event => onChange({ newLine: event.target.value === 'new' })}><option value="new">另起一行</option><option value="same">与上一字段同行</option></select></Field>
    <Field label="对齐" htmlFor={`${prefix}-align`}><select id={`${prefix}-align`} aria-label={`${spec.label}对齐方式`} value={field.align} disabled={rich} onChange={event => onChange({ align: event.target.value as ContentFieldLayout['align'] })}><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></Field>
    <Field label="文字" htmlFor={`${prefix}-emphasis`}><select id={`${prefix}-emphasis`} aria-label={`${spec.label}文字样式`} value={field.emphasis} disabled={rich} onChange={event => onChange({ emphasis: event.target.value as ContentFieldLayout['emphasis'] })}><option value="normal">正常</option><option value="bold">加粗</option><option value="muted">次要</option></select></Field>
    <div className="content-layout-visible"><span>显示</span><Toggle checked={field.visible} label={`显示${spec.label}字段`} onChange={visible => onChange({ visible })} /></div>
    <div className="content-layout-move"><IconButton label={`上移${spec.label}字段`} disabled={first} onClick={() => onMove(-1)}><ArrowUp size={13} /></IconButton><IconButton label={`下移${spec.label}字段`} disabled={last} onClick={() => onMove(1)}><ArrowDown size={13} /></IconButton></div>
    <div className="content-layout-typography"><Field label="字号（px）" htmlFor={`${prefix}-font-size`}><input id={`${prefix}-font-size`} type="number" min={8} max={36} step={.25} aria-label={`${spec.label}字号`} value={sizeText} onChange={event => changeSize(event.currentTarget.value)} onBlur={finishSize} /></Field><div className="content-layout-decoration" role="group" aria-label={`${spec.label}格式`}><button type="button" aria-label={`${spec.label}斜体`} aria-pressed={Boolean(field.italic)} onClick={() => onChange({ italic: !field.italic })}><Italic size={14} />斜体</button><button type="button" aria-label={`${spec.label}下划线`} aria-pressed={Boolean(field.underline)} onClick={() => onChange({ underline: !field.underline })}><Underline size={14} />下划线</button></div>{field.fontSizePx === undefined ? <small>跟随页面 · {pageFontSizePx}px</small> : <button type="button" className="text-button content-layout-inherit" aria-label={`${spec.label}字号跟随页面`} onClick={() => { setSizeText(String(pageFontSizePx)); onChange({ fontSizePx: undefined }); }}>跟随页面 · {pageFontSizePx}px</button>}</div>
  </div>;
}

export function ContentLayoutDialog({ section, pageFontSizePx, open, onClose }: { section: Section; pageFontSizePx: number; open: boolean; onClose: () => void }) {
  const update = useApp(state => state.update);
  const [draft, setDraft] = useState<SectionContentLayout>(() => resolveContentLayout(section));
  const [templateMode, setTemplateMode] = useState(!section.contentLayout);
  useEffect(() => { if (open) { setDraft(resolveContentLayout(section)); setTemplateMode(!section.contentLayout); } }, [open, section.id]);
  const title = sectionTitle(section) || '未命名模块';
  const specs = new Map(contentFieldSpecs(section).map(field => [field.key, field]));
  const resolved = resolveContentLayout({ ...section, contentLayout: draft });
  const rows = contentLayoutRows({ ...section, contentLayout: resolved });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const patch = (key: string, changes: Partial<ContentFieldLayout>) => { setTemplateMode(false); setDraft(current => { const next = resolveContentLayout({ ...section, contentLayout: current }); next.fields = next.fields.map(field => field.key === key ? { ...field, ...changes } : field); return next; }); };
  const move = (from: number, to: number) => { if (from < 0 || from >= resolved.fields.length || to < 0 || to >= resolved.fields.length || from === to) return; setTemplateMode(false); setDraft(current => { const next = resolveContentLayout({ ...section, contentLayout: current }); next.fields = arrayMove(next.fields, from, to); return next; }); };
  const setGap = (key: 'rowGapPx' | 'itemGapPx', value: number) => { if (!Number.isFinite(value)) return; setTemplateMode(false); setDraft(current => ({ ...current, [key]: Math.max(0, Math.min(key === 'rowGapPx' ? 24 : 48, value)) })); };
  const apply = () => {
    update(next => { const current = next.sections.find(item => item.id === section.id); if (!current) return; if (templateMode) delete current.contentLayout; else current.contentLayout = resolveContentLayout({ ...current, contentLayout: structuredClone(resolved) }); });
    useApp.getState().notify({ message: templateMode ? `${title}已恢复模板排版` : `${title}的内部排版已应用` });
    onClose(); void useApp.getState().flush();
  };
  return <Modal open={open} onClose={onClose} title={`${title} · 模块内排版`} description="调整字段的顺序、同行和对齐方式。本模块的所有条目共用此排版，填写的内容会保留。" wide>
    <div className="modal-body content-layout-body">
      <div className="content-layout-intro"><strong>字段排列</strong><span>{templateMode ? '模板排版方案' : '自定义方案'}</span></div>
      <p className="content-layout-help">拖动左侧手柄或使用上下箭头排序。字号、斜体和下划线按字段设置；正文的局部格式会保留。</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; move(resolved.fields.findIndex(field => field.key === active.id), resolved.fields.findIndex(field => field.key === over.id)); }}>
        <SortableContext items={resolved.fields.map(field => field.key)} strategy={verticalListSortingStrategy}><div className="content-layout-fields">{resolved.fields.map((field, index) => <LayoutField key={field.key} field={field} spec={specs.get(field.key)!} first={index === 0} last={index === resolved.fields.length - 1} afterRich={specs.get(resolved.fields[index - 1]?.key)?.type === 'rich'} prefix={`content-layout-${section.id}-${field.key}`} pageFontSizePx={pageFontSizePx} onChange={changes => patch(field.key, changes)} onMove={direction => move(index, index + direction)} />)}</div></SortableContext>
      </DndContext>
      {resolved.fields.length === 0 && <p className="content-layout-help">先在模块中添加可显示的字段。</p>}
      <div className="content-layout-spacing"><Field label="行间距（px）" htmlFor={`content-layout-${section.id}-row-gap`}><input id={`content-layout-${section.id}-row-gap`} type="number" min={0} max={24} step={1} value={resolved.rowGapPx} onChange={event => setGap('rowGapPx', event.currentTarget.valueAsNumber)} /></Field><Field label="条目间距（px）" htmlFor={`content-layout-${section.id}-item-gap`}><input id={`content-layout-${section.id}-item-gap`} type="number" min={0} max={48} step={1} value={resolved.itemGapPx} onChange={event => setGap('itemGapPx', event.currentTarget.valueAsNumber)} /></Field></div>
      <section className="content-layout-preview" aria-label="字段排列示意"><h3>字段排列示意</h3><div className="content-layout-sketch" style={{ gap: resolved.rowGapPx }}>{rows.map((row, index) => <div className="content-layout-sketch-row" key={index} data-layout-row={index + 1}>{row.map(field => <span key={field.key} className={`layout-emphasis-${field.emphasis}`} style={{ textAlign: specs.get(field.key)?.type === 'rich' ? 'left' : field.align, fontSize: field.fontSizePx ?? pageFontSizePx, fontStyle: field.italic ? 'italic' : undefined, textDecoration: field.underline ? 'underline' : undefined }}>{specs.get(field.key)?.label || '未命名字段'}</span>)}</div>)}{rows.length === 0 && <p>所有字段均已隐藏，原始内容仍会保留。</p>}</div><small>示意显示行、对齐和文字样式；未填写的字段不会占位置。应用后可在简历预览中查看效果。</small></section>
    </div>
    <div className="content-layout-footer"><Button secondary onClick={() => { setDraft(defaultContentLayout(section)); setTemplateMode(true); }}><RotateCcw size={14} />恢复模板排版</Button><div className="content-layout-actions"><Button secondary onClick={onClose}>取消</Button><Button onClick={apply}>应用排版</Button></div></div>
  </Modal>;
}
