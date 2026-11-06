import { useId, useLayoutEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Award, BadgeCheck, BookOpen, Briefcase, Building2, ChevronDown, ChevronRight, Contact, Copy, Folder, GraduationCap, GripVertical, Heart, Languages, Layers, Pencil, Plus, SlidersHorizontal, Trash2, UserRound, Wrench, X } from 'lucide-react';
import type { Basics, CustomSection, FieldValue, ItemKind, Resume, RichDocument, Section, SectionKind } from '../../domain/types';
import { CUSTOM_FIELD_TYPES, FIELD_SPECS, LEVEL_LABELS, SECTION_ORDER, sectionTitle } from '../../domain/registry';
import { emptyRich, itemName, newItem, newSection, uid } from '../../domain/resume';
import { useApp } from '../../app/store';
import { Button, Field, IconButton, Menu, Modal, Toggle, useObjectUrl } from '../../components/ui';
import { RichEditor } from './RichEditor';
import { AvatarDialog } from './AvatarDialog';
import { ContentLayoutDialog } from './ContentLayoutDialog';
import { addSchoolAndMajor, basicFieldKind, COMMON_SCHOOLS } from '../../domain/basicFields';
import './content-actions.css';

const icons = { summary: UserRound, profiles: Contact, education: GraduationCap, work: Briefcase, projects: Folder, internships: Building2, skills: Wrench, languages: Languages, awards: Award, certifications: BadgeCheck, interests: Heart, publications: BookOpen, volunteer: Heart, references: Contact, custom: Layers };
export function SectionIcon({ kind, size = 18 }: { kind: SectionKind; size?: number }) { const Icon = icons[kind]; return <Icon size={size} />; }
function editSection(resume: Resume, id: string, edit: (section: Section) => void) { const section = resume.sections.find(section => section.id === id); if (section) edit(section); }
function TagInput({ values, onChange, label }: { values: string[]; onChange: (values: string[]) => void; label: string }) {
  const [text, setText] = useState('');
  const add = () => { const next = text.trim(); if (next) onChange([...new Set([...values, next])]); setText(''); };
  return <div className="tag-input">{values.map(value => <span className="tag" key={value}>{value}<button type="button" aria-label={`删除关键词 ${value}`} onClick={() => onChange(values.filter(item => item !== value))}><X size={12} /></button></span>)}<input aria-label={label} value={text} placeholder="输入后按 Enter" onChange={event => setText(event.target.value)} onBlur={add} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } if (event.key === 'Backspace' && !text) onChange(values.slice(0, -1)); }} /></div>;
}
function ValueEditor({ label, type, value, onChange, id, placeholder, epoch }: { label: string; type: string; value: FieldValue | undefined; onChange: (value: FieldValue) => void; id: string; placeholder?: string; epoch: number }) {
  if (type === 'rich') return <Field label={label} full><RichEditor label={label} value={value && typeof value === 'object' && !Array.isArray(value) ? value : emptyRich()} onChange={onChange} epoch={epoch} /></Field>;
  if (type === 'tags') return <Field label={label} full><TagInput values={Array.isArray(value) ? value : []} onChange={onChange} label={label} /></Field>;
  if (type === 'level') return <Field label={label} htmlFor={id}><select id={id} value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value ? Number(event.target.value) as FieldValue : null)}><option value="">不显示等级</option>{LEVEL_LABELS.map((level, index) => <option key={level} value={index + 1}>{level}</option>)}</select></Field>;
  return <Field label={label} htmlFor={id} full={type === 'textarea'}>{type === 'textarea' ? <textarea id={id} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} rows={3} placeholder={placeholder} /> : <input id={id} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} type="text" inputMode={type === 'url' ? 'url' : undefined} />}{typeof value === 'string' && value.includes('\uFFFD') && <p className="field-error" role="status">这是 PDF 未能识别的字符，请对照原文填写{label}。</p>}</Field>;
}
function BasicCustomField({ field, schoolListId }: { field: Basics['customFields'][number]; schoolListId: string }) {
  const update = useApp(state => state.update);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const kind = basicFieldKind(field);
  const patch = (edit: (field: Basics['customFields'][number]) => void) => update(next => { const current = next.basics.customFields.find(item => item.id === field.id); if (current) edit(current); });
  const choices = [['briefcase', '工作'], ['globe', '网站'], ['mail', '邮箱'], ['phone', '电话'], ['link', '链接'], ['school', '院校'], ['major', '专业']];
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined }} className="basic-custom-field" data-basic-field-id={field.id}>
    <button type="button" className="drag-handle" aria-label={`拖动基本字段 ${field.label || '未命名字段'}`} title="拖动排序" {...attributes} {...listeners}><GripVertical size={16} /></button>
    <select aria-label="自定义字段图标" value={field.iconId} onChange={event => { const iconId = event.target.value; patch(current => { current.iconId = iconId; if (!current.label.trim() && (iconId === 'school' || iconId === 'major')) current.label = iconId === 'school' ? '院校' : '专业'; }); }}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <input aria-label="自定义字段名称" value={field.label} placeholder="字段名称" onChange={event => patch(current => { current.label = event.target.value; })} />
    <input aria-label={kind === 'school' ? '院校' : kind === 'major' ? '专业' : '自定义字段内容'} list={kind === 'school' ? schoolListId : undefined} value={field.value} placeholder={kind === 'school' ? '选择或输入院校' : kind === 'major' ? '填写所学专业' : '内容'} onChange={event => patch(current => { current.value = event.target.value; })} />
    <Toggle label={`显示自定义字段 ${field.label}`} checked={field.visible} onChange={visible => patch(current => { current.visible = visible; })} />
    <IconButton label="删除基本信息自定义字段" onClick={async () => { const index = useApp.getState().current?.basics.customFields.findIndex(item => item.id === field.id) ?? 0; if (!(await useApp.getState().tracked('删除基本信息字段', next => { next.basics.customFields = next.basics.customFields.filter(item => item.id !== field.id); }))) return; useApp.getState().notify({ message: '字段已移除', action: { label: '撤销', run: () => update(next => { next.basics.customFields.splice(index, 0, field); }) } }); }}><X size={15} /></IconButton>
  </div>;
}
export function BasicsEditor({ resume, idPrefix = 'basics', highlighted = false }: { resume: Resume; idPrefix?: string; highlighted?: boolean }) {
  const update = useApp(state => state.update), assets = useApp(state => state.assets);
  const [photoOpen, setPhotoOpen] = useState(false);
  const avatar = resume.basics.avatarAssetId ? assets[resume.basics.avatarAssetId] : undefined;
  const avatarUrl = useObjectUrl(avatar?.blob);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const schoolListId = `${idPrefix}-school-options`;
  const fields = [{ key: 'name', label: '全名', placeholder: '你的姓名' }, { key: 'headline', label: '职位', placeholder: '例如：前端开发工程师' }, { key: 'email', label: '邮箱', placeholder: 'name@example.com' }, { key: 'website', label: '个人主页', placeholder: 'https://example.com' }, { key: 'phone', label: '电话', placeholder: '联系电话' }, { key: 'location', label: '位置', placeholder: '城市 / 地区' }] as const;
  return <section className={`section-card basics-card ${highlighted ? 'preview-edit-target' : ''}`} id="section-basics"><div className="section-header"><SectionIcon kind="summary" /><h2>基本信息</h2></div><div className="basics-grid"><div className="avatar-control"><button type="button" className="avatar-upload" aria-label="上传或设置头像" onClick={() => setPhotoOpen(true)}>{avatarUrl ? <img src={avatarUrl} alt="简历头像" /> : <><UserRound size={29} /><span>添加照片</span></>}</button><button type="button" className="text-button" onClick={() => setPhotoOpen(true)}>头像设置</button></div><div className="form-grid">{fields.map(field => <Field label={field.label} htmlFor={`${idPrefix}-${field.key}`} key={field.key}><input id={`${idPrefix}-${field.key}`} value={resume.basics[field.key]} onChange={event => update(next => { next.basics[field.key] = event.target.value; })} placeholder={field.placeholder} autoComplete="off" /></Field>)}</div></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; update(next => { const fields = next.basics.customFields; const from = fields.findIndex(field => field.id === active.id), to = fields.findIndex(field => field.id === over.id); if (from >= 0 && to >= 0) next.basics.customFields = arrayMove(fields, from, to); }); }}>
      <SortableContext items={resume.basics.customFields.map(field => field.id)} strategy={verticalListSortingStrategy}>{resume.basics.customFields.map(field => <BasicCustomField field={field} key={field.id} schoolListId={schoolListId} />)}</SortableContext>
    </DndContext>
    <datalist id={schoolListId}>{COMMON_SCHOOLS.map(school => <option value={school} key={school} />)}</datalist>
    <div className="basic-add-actions"><button type="button" className="add-dashed" onClick={() => update(next => { next.basics.customFields.push({ id: uid('basic'), iconId: 'briefcase', label: '', value: '', visible: true }); })}><Plus size={15} />新增自定义字段</button><button type="button" className="add-dashed" onClick={() => update(next => addSchoolAndMajor(next.basics))}><GraduationCap size={15} />添加院校与专业</button></div>
    <AvatarDialog open={photoOpen} onClose={() => setPhotoOpen(false)} resume={resume} />
  </section>;
}
function ItemEditor({ section, resumeId, itemId, open, onOpen, onToggle, onClose }: { section: Exclude<Section, { kind: 'summary' }>; resumeId: string; itemId: string; open: boolean; onOpen: (id: string) => void; onToggle: () => void; onClose: () => void }) {
  const update = useApp(state => state.update), epoch = useApp(state => state.contentEpoch);
  const item = section.items.find(item => item.id === itemId)!;
  const index = section.items.findIndex(item => item.id === itemId);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: itemId });
  const [deleteOpen, setDeleteOpen] = useState(false), [finishing, setFinishing] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null), focusAfterClose = useRef(false);
  const copiedItemToFocus = useRef<string | null>(null);
  const bodyId = useId(), toggleId = useId();
  useLayoutEffect(() => { if (!open && focusAfterClose.current) { focusAfterClose.current = false; toggle.current?.focus({ preventScroll: true }); } }, [open]);
  const editItem = (edit: (found: typeof item) => void) => {
    if (useApp.getState().current?.id !== resumeId) return;
    update(next => editSection(next, section.id, current => { if (current.kind === 'summary') return; const found = current.items.find(item => item.id === itemId); if (found) edit(found as typeof item); }));
  };
  const setValue = (key: string, value: FieldValue) => editItem(found => { if ('fields' in found) found.fields[key] = value; else found.values[key] = value as string | string[] | RichDocument; });
  const duplicate = () => {
    const clone = structuredClone(item); clone.id = uid('item');
    copiedItemToFocus.current = clone.id;
    update(next => { if (next.id !== resumeId) return; editSection(next, section.id, current => { if (current.kind === 'summary') return; const index = current.items.findIndex(item => item.id === itemId); if (index >= 0) (current.items as typeof item[]).splice(index + 1, 0, clone); }); });
    onOpen(clone.id);
    useApp.getState().notify({ message: '已复制条目，可直接修改副本' });
  };
  const move = (direction: number) => {
    update(next => { if (next.id !== resumeId) return; editSection(next, section.id, current => {
      if (current.kind === 'summary') return;
      const from = current.items.findIndex(item => item.id === itemId), to = from + direction;
      if (from >= 0 && to >= 0 && to < current.items.length) current.items = arrayMove(current.items as typeof item[], from, to) as never;
    }); });
    useApp.getState().notify({ message: direction < 0 ? '条目已上移' : '条目已下移' });
  };
  const changeVisibility = () => {
    const previous = item.visible;
    editItem(found => { found.visible = !previous; });
    useApp.getState().notify({ message: previous ? '条目已隐藏，内容保留' : '条目已显示', action: { label: '撤销', run: () => editItem(found => { found.visible = previous; }) } });
  };
  const finish = async () => {
    setFinishing(true);
    try {
      const success = await useApp.getState().flush();
      if (useApp.getState().current?.id !== resumeId) return;
      if (!success) { useApp.getState().notify({ message: '内容尚未保存，已保留当前编辑。请重试保存或下载草稿。', error: true }); return; }
      if (useApp.getState().dirty) { useApp.getState().notify({ message: '新修改正在保存，稍后可完成编辑。' }); return; }
      focusAfterClose.current = true; onClose();
    } catch {
      if (useApp.getState().current?.id === resumeId) useApp.getState().notify({ message: '内容尚未保存，已保留当前编辑。请重试保存或下载草稿。', error: true });
    } finally { setFinishing(false); }
  };
  const specs = section.kind === 'custom' ? section.fieldDefinitions.filter(field => field.visible).map(field => ({ key: field.id, label: field.label, type: CUSTOM_FIELD_TYPES.find(type => type.value === field.type)!.editor, placeholder: undefined })) : FIELD_SPECS[section.kind];
  const values = 'fields' in item ? item.fields : item.values;
  return <div ref={setNodeRef} data-item-id={itemId} style={{ transform: CSS.Transform.toString(transform), transition }} className={`item-card ${!item.visible ? 'is-hidden' : ''}`}>
    <div className="item-heading"><button type="button" className="drag-handle" aria-label={`拖动 ${itemName(section, itemId)}`} {...attributes} {...listeners}><GripVertical size={16} /></button><button ref={toggle} id={toggleId} type="button" className="item-toggle" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} title={`${open ? '收起' : '展开'} ${itemName(section, itemId)}`}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>{itemName(section, itemId)}</span>{!item.visible && <small>已隐藏</small>}</button><Menu label={`条目操作 ${itemName(section, itemId)}`} onCloseAutoFocus={event => { const itemId = copiedItemToFocus.current; if (!itemId) return; event.preventDefault(); copiedItemToFocus.current = null; onOpen(itemId); }} items={[
      { label: '复制条目', icon: <Copy size={14} />, onClick: duplicate },
      { label: '上移条目', icon: <ArrowUp size={14} />, disabled: index === 0, onClick: () => move(-1) },
      { label: '下移条目', icon: <ArrowDown size={14} />, disabled: index === section.items.length - 1, onClick: () => move(1) },
      { label: item.visible ? '隐藏条目' : '显示条目', onClick: changeVisibility },
      { label: '删除条目', icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleteOpen(true) },
    ]} /></div>
    <div id={bodyId} className="item-body" hidden={!open} aria-labelledby={toggleId}>{open && <><div className="form-grid">{specs.map(spec => <ValueEditor key={spec.key} label={spec.label} type={spec.type} placeholder={spec.placeholder} value={values[spec.key]} id={`item-${itemId}-${spec.key}`} epoch={epoch} onChange={value => setValue(spec.key, value)} />)}</div><div className="item-actions"><Button secondary loading={finishing} onClick={() => void finish()}>完成编辑</Button></div></>}</div>
    <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="删除这条经历？" description="删除前会保存历史版本，也可以立即撤销。"><div className="modal-body"><div className="modal-actions"><Button secondary onClick={() => setDeleteOpen(false)}>取消</Button><Button onClick={async () => {
      const removed = structuredClone(item);
      const index = section.items.findIndex(item => item.id === itemId);
      const success = await useApp.getState().tracked('删除条目', next => { if (next.id !== resumeId) return; editSection(next, section.id, current => { if (current.kind !== 'summary') current.items = current.items.filter(item => item.id !== itemId) as never; }); });
      if (!success) return;
      setDeleteOpen(false);
      useApp.getState().notify({ message: '条目已删除', action: { label: '撤销', run: () => update(next => { if (next.id !== resumeId) return; editSection(next, section.id, current => { if (current.kind !== 'summary' && !current.items.some(item => item.id === itemId)) (current.items as typeof item[]).splice(Math.max(0, index), 0, removed); }); }) } });
    }}>删除条目</Button></div></div></Modal>
  </div>;
}

function CustomFieldsDialog({ section, open, onClose }: { section: CustomSection; open: boolean; onClose: () => void }) {
  const update = useApp(state => state.update);
  return <Modal open={open} onClose={onClose} title="配置自定义字段" description="隐藏字段保留内容，修改名称不会改变已有数据。"><div className="modal-body"><div className="custom-definition-list">{section.fieldDefinitions.map(field => <div className="custom-definition" key={field.id}><input aria-label="字段显示名称" value={field.label} onChange={event => update(next => editSection(next, section.id, current => { if (current.kind === 'custom') current.fieldDefinitions.find(item => item.id === field.id)!.label = event.target.value; }))} /><span>{CUSTOM_FIELD_TYPES.find(type => type.value === field.type)?.label}</span><Toggle label={`显示字段 ${field.label}`} checked={field.visible} onChange={visible => update(next => editSection(next, section.id, current => { if (current.kind === 'custom') current.fieldDefinitions.find(item => item.id === field.id)!.visible = visible; }))} /><IconButton label={`删除字段 ${field.label}`} onClick={async () => { const index = section.fieldDefinitions.indexOf(field), oldValues = new Map(section.items.map(item => [item.id, item.values[field.id]])); const success = await useApp.getState().tracked('删除自定义字段', next => editSection(next, section.id, current => { if (current.kind === 'custom') { current.fieldDefinitions = current.fieldDefinitions.filter(item => item.id !== field.id); current.items.forEach(item => { delete item.values[field.id]; }); } })); if (!success) return; useApp.getState().notify({ message: '自定义字段已移除', action: { label: '撤销', run: () => update(next => editSection(next, section.id, current => { if (current.kind === 'custom') { current.fieldDefinitions.splice(index, 0, field); current.items.forEach(item => { const value = oldValues.get(item.id); if (value !== undefined) item.values[field.id] = value; }); } })) } }); }}><X size={15} /></IconButton></div>)}</div><Field label="新增字段"><select defaultValue="" onChange={event => { if (!event.target.value) return; const type = CUSTOM_FIELD_TYPES.find(type => type.value === event.target.value)!; update(next => editSection(next, section.id, current => { if (current.kind === 'custom') current.fieldDefinitions.push({ id: uid('field'), type: type.value, label: type.label, visible: true }); })); event.target.value = ''; }}><option value="">选择字段类型</option>{CUSTOM_FIELD_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field><div className="modal-actions"><Button onClick={onClose}>完成</Button></div></div></Modal>;
}
function SectionEditor({ section, resume, highlighted = false }: { section: Section; resume: Resume; highlighted?: boolean }) {
  const update = useApp(state => state.update), epoch = useApp(state => state.contentEpoch);
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const element = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ itemId: string } | null>(null);
  const openAndFocus = (itemId: string) => { setOpenItems(previous => new Set([...previous, itemId])); setFocusRequest({ itemId }); };
  useLayoutEffect(() => {
    if (!focusRequest || !element.current) return;
    const root = element.current;
    let frame = 0, observer: MutationObserver | undefined, done = false;
    const focusField = () => {
      if (done || !root.isConnected) return;
      const card = Array.from(root.querySelectorAll<HTMLElement>('[data-item-id]')).find(card => card.dataset.itemId === focusRequest.itemId);
      const field = card?.querySelector<HTMLElement>('.item-body input:not([disabled]),.item-body textarea:not([disabled]),.item-body select:not([disabled]),.item-body [contenteditable="true"]');
      if (!field || !field.getClientRects().length) return;
      done = true; observer?.disconnect(); card?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      field.focus({ preventScroll: true }); setFocusRequest(null);
    };
    // Allow the expanded fields to mount; rich editors may appear later.
    // Menu actions request focus again after their focus scope closes.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(focusField); });
    observer = new MutationObserver(() => { if (!done) { cancelAnimationFrame(frame); frame = requestAnimationFrame(focusField); } });
    observer.observe(root, { childList: true, subtree: true });
    return () => { done = true; cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [focusRequest, openItems]);
  const [renaming, setRenaming] = useState(false), [configure, setConfigure] = useState(false), [deleteOpen, setDeleteOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const addedItemToFocus = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const title = sectionTitle(section);
  const changeVisibility = (visible: boolean) => {
    const previous = section.visible;
    const setVisibility = (value: boolean) => update(next => { if (next.id === resume.id) editSection(next, section.id, current => { current.visible = value; }); });
    setVisibility(visible);
    useApp.getState().notify({ message: visible ? `${title || '模块'}已显示` : `${title || '模块'}已隐藏，内容保留`, action: { label: '撤销', run: () => setVisibility(previous) } });
  };
  const addItem = () => {
    if (section.kind === 'summary') return;
    const item = section.kind === 'custom' ? { id: uid('item'), visible: true, values: Object.fromEntries(section.fieldDefinitions.map(field => [field.id, field.type === 'summary' ? emptyRich() : field.type === 'keywords' ? [] : ''])) } : newItem(section.kind);
    update(next => editSection(next, section.id, current => { if (current.kind !== 'summary') (current.items as typeof item[]).push(item); }));
    openAndFocus(item.id);
    return item.id;
  };
  return <section ref={element} className={`section-card ${!section.visible ? 'is-hidden' : ''} ${highlighted ? 'preview-edit-target' : ''}`} id={section.kind === "custom" ? `section-custom-${section.id}` : `section-${section.kind}`} data-section-id={section.id}><div className="section-header"><SectionIcon kind={section.kind} />{renaming ? <input className="title-edit" aria-label="模块标题" autoFocus value={section.titleOverride ?? title} onChange={event => update(next => editSection(next, section.id, current => { current.titleOverride = event.target.value; }))} onBlur={() => setRenaming(false)} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') setRenaming(false); }} /> : <h2>{title || '未命名模块'}</h2>}<IconButton label={`重命名${title}`} className="header-edit" onClick={() => setRenaming(true)}><Pencil size={13} /></IconButton><span className="header-spacer" />{section.kind !== 'summary' && <button type="button" className="section-add-item" aria-label={`新增${title || '模块'}条目`} title={`新增${title || '模块'}条目`} onClick={addItem}><Plus size={14} /><span>新增</span></button>}<button type="button" className={`content-layout-trigger ${section.contentLayout ? 'has-layout' : ''}`} aria-label={`${title}模块内排版`} title="模块内排版" onClick={() => setLayoutOpen(true)}><SlidersHorizontal size={12} /><span>模块内排版</span></button><Toggle label={`显示${title}`} checked={section.visible} onChange={changeVisibility} /><Menu label={`${title}模块操作`} onCloseAutoFocus={event => { const itemId = addedItemToFocus.current; if (!itemId) return; event.preventDefault(); addedItemToFocus.current = null; openAndFocus(itemId); }} items={[
      ...(section.kind === 'summary' ? [] : [{ label: '新增条目', icon: <Plus size={14} />, onClick: () => { addedItemToFocus.current = addItem() ?? null; } }]),
      { label: '修改标题', icon: <Pencil size={14} />, onClick: () => setRenaming(true) },
      { label: '模块内排版', icon: <SlidersHorizontal size={14} />, onClick: () => setLayoutOpen(true) },
      ...(section.kind === 'custom' ? [{ label: '配置字段', onClick: () => setConfigure(true) }] : []),
      { label: '删除模块', icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleteOpen(true) },
    ]} /></div>
    {section.kind === 'summary' ? <RichEditor value={section.content} label="个人总结" epoch={epoch} onChange={content => update(next => editSection(next, section.id, current => { if (current.kind === 'summary') current.content = content; }))} /> : <><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (!over || active.id === over.id) return; update(next => editSection(next, section.id, current => { if (current.kind !== 'summary') { const items = current.items; current.items = arrayMove(items as { id: string; visible: boolean }[], items.findIndex(item => item.id === active.id), items.findIndex(item => item.id === over.id)) as never; } })); }}><SortableContext items={section.items.map(item => item.id)} strategy={verticalListSortingStrategy}>{section.items.map(item => <ItemEditor key={item.id} section={section} resumeId={resume.id} itemId={item.id} open={openItems.has(item.id)} onOpen={openAndFocus} onClose={() => setOpenItems(previous => { const next = new Set(previous); next.delete(item.id); return next; })} onToggle={() => setOpenItems(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />)}</SortableContext></DndContext><button type="button" className="add-dashed" onClick={addItem}><Plus size={15} />新增{title.replace(/背景|经历/g, '') || '条目'}</button></>}
    {section.kind === 'custom' && <CustomFieldsDialog section={section} open={configure} onClose={() => setConfigure(false)} />}
    <ContentLayoutDialog section={section} pageFontSizePx={resume.appearance.fontSizePx} open={layoutOpen} onClose={() => setLayoutOpen(false)} />
    <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`删除${title || '模块'}？`} description="模块内容会被移除，删除前保存历史版本。"><div className="modal-body"><div className="modal-actions"><Button secondary onClick={() => setDeleteOpen(false)}>取消</Button><Button onClick={async () => {
      const index = resume.sections.findIndex(item => item.id === section.id); const positions = resume.layout.groups.map(group => ({ id: group.id, main: group.main.indexOf(section.id), sidebar: group.sidebar.indexOf(section.id) }));
      const success = await useApp.getState().tracked('删除模块', next => { next.sections = next.sections.filter(item => item.id !== section.id); next.layout.groups.forEach(group => { group.main = group.main.filter(id => id !== section.id); group.sidebar = group.sidebar.filter(id => id !== section.id); }); });
      if (!success) return; setDeleteOpen(false); useApp.getState().notify({ message: '模块已删除', action: { label: '撤销', run: () => update(next => { if (next.sections.some(item => item.id === section.id)) return; next.sections.splice(index, 0, section); const position = positions.find(position => position.main >= 0 || position.sidebar >= 0); const group = next.layout.groups.find(group => group.id === position?.id) ?? next.layout.groups[0]; const column = position && position.sidebar >= 0 ? 'sidebar' : 'main'; group[column].splice(position?.[column] ?? group[column].length, 0, section.id); }) } });
    }}>删除模块</Button></div></div></Modal>
  </section>;
}
export function ContentEditor({ resume, highlightedTarget }: { resume: Resume; highlightedTarget?: string | null }) {
  const update = useApp(state => state.update); const [customOpen, setCustomOpen] = useState(false), [title, setTitle] = useState('');
  const layoutOrder = resume.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
  const ordered = resume.layout.mode === 'single' ? layoutOrder.map(id => resume.sections.find(section => section.id === id)!).filter(Boolean) : [...resume.sections].sort((a, b) => a.kind === 'custom' ? 1 : b.kind === 'custom' ? -1 : SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
  const missing = SECTION_ORDER.filter(kind => !resume.sections.some(section => section.kind === kind));
  return <><BasicsEditor resume={resume} highlighted={highlightedTarget === 'basics'} />{ordered.map(section => <SectionEditor key={section.id} section={section} resume={resume} highlighted={highlightedTarget === section.id} />)}<div className="module-add-row"><Button secondary onClick={() => { setTitle(''); setCustomOpen(true); }}><Plus size={16} />新增自定义模块</Button>{missing.length > 0 && <select aria-label="添加内置模块" defaultValue="" onChange={event => { if (!event.target.value) return; const section = newSection(event.target.value as ItemKind | 'summary'); update(next => { next.sections.push(section); next.layout.groups[0].main.push(section.id); }); event.target.value = ''; }}><option value="">添加内置模块</option>{missing.map(kind => <option value={kind} key={kind}>{sectionTitle(newSection(kind))}</option>)}</select>}</div>
    <Modal open={customOpen} onClose={() => setCustomOpen(false)} title="新增自定义模块" description="适合校园活动、作品集等额外内容，之后可以配置字段。"><div className="modal-body"><Field label="模块名称" htmlFor="new-custom-title"><input id="new-custom-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：校园活动" /></Field><div className="modal-actions"><Button secondary onClick={() => setCustomOpen(false)}>取消</Button><Button disabled={!title.trim()} onClick={() => { const section: CustomSection = { id: uid('section'), kind: 'custom', titleOverride: title.trim(), visible: true, fieldDefinitions: [{ id: uid('field'), type: 'name', label: '名称', visible: true }, { id: uid('field'), type: 'summary', label: '详情', visible: true }], items: [] }; update(next => { next.sections.push(section); next.layout.groups[0].main.push(section.id); }); setCustomOpen(false); }}>创建模块</Button></div></div></Modal>
  </>;
}
