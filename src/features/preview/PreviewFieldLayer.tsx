import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import type { AlignmentScope, FieldDropPlacement, PreviewFieldDrop, PreviewFieldRegion, TextAlignment } from '../../domain/types';
import { alignmentLabels, alignmentScopeLabels } from '../../domain/fieldAlignment';
import type { PreviewAlignmentActions } from './previewAlignment';
import { Button, Field, Modal } from '../../components/ui';
import { fieldPlacementLabels, hitTestPreviewField, type PreviewFieldHit } from './fieldDropHitTest';
import { previewFieldHitAreas } from './fieldHitAreas';
import './preview-fields.css';

interface DragState { source: PreviewFieldRegion; moved: boolean; x: number; y: number; hit: PreviewFieldHit | null }
interface PendingDrag { source: PreviewFieldRegion; pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean; element: HTMLElement }
interface FieldDragContextValue {
  enabled: boolean; drag: DragState | null;
  register: (page: number, element: HTMLDivElement | null) => void;
  start: (event: ReactPointerEvent<HTMLButtonElement>, field: PreviewFieldRegion) => void;
  click: (field: PreviewFieldRegion, trigger: HTMLButtonElement) => void;
}
const FieldDragContext = createContext<FieldDragContextValue | null>(null);

export function PreviewFieldDragProvider({ enabled, fields, scale, scrollContainer, onDrop, alignment, toolbarTarget, children }: { enabled: boolean; fields: readonly PreviewFieldRegion[]; scale: number; scrollContainer: RefObject<HTMLDivElement | null>; onDrop?: (drop: PreviewFieldDrop) => void; alignment?: PreviewAlignmentActions; toolbarTarget?: HTMLElement | null; children: ReactNode }) {
  const pages = useRef(new Map<number, HTMLDivElement>()), pending = useRef<PendingDrag | null>(null), ignoreClickUntil = useRef(0);
  const onDropRef = useRef(onDrop); onDropRef.current = onDrop;
  const register = useCallback((page: number, element: HTMLDivElement | null) => { if (element) pages.current.set(page, element); else pages.current.delete(page); }, []);
  const [drag, setDrag] = useState<DragState | null>(null), [menuField, setMenuField] = useState<PreviewFieldRegion | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const [menuTarget, setMenuTarget] = useState(''), [menuPlacement, setMenuPlacement] = useState<FieldDropPlacement>('after');
  const controlId = useId();
  const [dropAlign, setDropAlign] = useState<TextAlignment | 'keep'>('keep'), [dropScope, setDropScope] = useState<AlignmentScope>('field');
  const [menuAlign, setMenuAlign] = useState<TextAlignment | 'keep'>('keep'), [menuScope, setMenuScope] = useState<AlignmentScope>('field');
  const dropOptions = useRef({ value: dropAlign, scope: dropScope }); dropOptions.current = { value: dropAlign, scope: dropScope };
  const candidates = menuField ? [...new Map(fields.filter(field => field.sectionId === menuField.sectionId && field.itemId === menuField.itemId && field.fieldKey !== menuField.fieldKey).map(field => [field.fieldKey, field])).values()] : [];
  useEffect(() => {
    setMenuField(current => !enabled || !current ? null : fields.find(field => field.sectionId === current.sectionId && field.itemId === current.itemId && field.fieldKey === current.fieldKey) ?? null);
  }, [enabled, fields]);

  const hitAt = (source: PreviewFieldRegion, clientX: number, clientY: number) => {
    for (const [page, element] of pages.current) {
      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      return hitTestPreviewField(source, fields, page, (clientX - rect.left) / scale, (clientY - rect.top) / scale);
    }
    return null;
  };
  const finish = () => {
    const current = pending.current;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    pending.current = null; setDrag(null);
  };
  useEffect(() => {
    if (!enabled) { finish(); setMenuField(null); return; }
    const move = (event: PointerEvent) => {
      const current = pending.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
      current.moved = true; event.preventDefault();
      setDrag({ source: current.source, moved: true, x: current.x, y: current.y, hit: hitAt(current.source, current.x, current.y) });
    };
    const up = (event: PointerEvent) => {
      const current = pending.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const hit = current.moved ? hitAt(current.source, event.clientX, event.clientY) : null;
      if (current.moved) { event.preventDefault(); ignoreClickUntil.current = performance.now() + 450; }
      finish();
      const selected = dropOptions.current;
      if (hit) onDropRef.current?.({ sectionId: current.source.sectionId, sourceKey: current.source.fieldKey, targetKey: hit.target.fieldKey, placement: hit.placement, ...(alignment && selected.value !== 'keep' ? { alignment: { scope: selected.scope, value: selected.value } } : {}) });
    };
    const cancel = () => { if (pending.current?.moved) ignoreClickUntil.current = performance.now() + 450; finish(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && pending.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); if (pending.current) finish(); };
  }, [enabled, fields, scale]);

  useEffect(() => {
    if (!drag?.moved || !enabled) return;
    const previousCursor = document.body.style.cursor, previousSelection = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
    let frame = 0;
    const scroll = () => {
      const current = pending.current, element = scrollContainer.current;
      if (!current || !element) return;
      const box = element.getBoundingClientRect();
      const dy = current.y < box.top + 32 ? -10 : current.y > box.bottom - 32 ? 10 : 0;
      const dx = current.x < box.left + 24 ? -10 : current.x > box.right - 24 ? 10 : 0;
      if (dy || dx) { element.scrollBy(dx, dy); setDrag({ source: current.source, moved: true, x: current.x, y: current.y, hit: hitAt(current.source, current.x, current.y) }); }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => { cancelAnimationFrame(frame); document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection; };
  }, [drag?.moved, enabled, fields, scale]);

  const start = (event: ReactPointerEvent<HTMLButtonElement>, field: PreviewFieldRegion) => {
    if (!enabled || event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    pending.current = { source: field, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, element: event.currentTarget };
    setDrag({ source: field, moved: false, x: event.clientX, y: event.clientY, hit: null });
  };
  const click = (field: PreviewFieldRegion, trigger: HTMLButtonElement) => {
    if (!enabled || performance.now() < ignoreClickUntil.current) return;
    const target = fields.find(candidate => candidate.sectionId === field.sectionId && candidate.itemId === field.itemId && candidate.fieldKey !== field.fieldKey);
    menuTrigger.current = trigger;
    setMenuField(field); setMenuTarget(target?.fieldKey ?? ''); setMenuPlacement(field.rich || target?.rich ? 'below' : 'after');
    setMenuAlign(dropAlign); setMenuScope(dropScope);
  };
  const actualTarget = candidates.some(field => field.fieldKey === menuTarget) ? menuTarget : candidates[0]?.fieldKey ?? '';
  const richMove = menuField?.rich || candidates.find(field => field.fieldKey === actualTarget)?.rich;
  const actualPlacement = richMove && menuPlacement === 'before' ? 'above' : richMove && menuPlacement === 'after' ? 'below' : menuPlacement;
  const currentAlignment = menuField && alignment?.read(menuField.sectionId, menuField.fieldKey)[menuScope];
  const valueOptions = <><option value="keep">保持原对齐</option>{Object.entries(alignmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</>;
  const scopeOptions = Object.entries(alignmentScopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>);
  return <FieldDragContext.Provider value={{ enabled, drag, start, click, register }}>
    {children}
    {alignment && toolbarTarget && createPortal(<div className="preview-alignment-toolbar" aria-label="拖放对齐设置"><label htmlFor={`${controlId}-drop-align`}>拖放后对齐</label><select id={`${controlId}-drop-align`} aria-label="拖放后的对齐方式" value={dropAlign} onChange={event => setDropAlign(event.target.value as TextAlignment | 'keep')}>{valueOptions}</select><label htmlFor={`${controlId}-drop-scope`}>应用到</label><select id={`${controlId}-drop-scope`} aria-label="拖放对齐范围" value={dropScope} disabled={dropAlign === 'keep'} onChange={event => setDropScope(event.target.value as AlignmentScope)}>{scopeOptions}</select><small>整行相对所属栏对齐</small></div>, toolbarTarget)}
    {drag?.moved && createPortal(<div className="preview-field-drag-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}><GripVertical size={13} />{drag.source.label}<small>{drag.hit ? `${drag.hit.target.label} · ${fieldPlacementLabels[drag.hit.placement]}` : '拖到另一字段的左右或上下'}{dropAlign !== 'keep' && alignment ? ` · ${alignmentScopeLabels[dropScope]}${alignmentLabels[dropAlign]}` : ''}</small></div>, document.body)}
    <Modal open={Boolean(menuField)} onClose={() => setMenuField(null)} returnFocusRef={menuTrigger} title={`调整${menuField?.label ?? ''}字段`} description="可以只调整对齐，也可以移动并设置落点对齐。同一模块的所有条目共用设置。">
      <div className="modal-body">
        {alignment && <div className="preview-alignment-menu"><Field label="对齐范围" htmlFor={`${controlId}-menu-scope`}><select id={`${controlId}-menu-scope`} value={menuScope} onChange={event => setMenuScope(event.target.value as AlignmentScope)}>{scopeOptions}</select></Field><Field label="对齐方式" htmlFor={`${controlId}-menu-align`}><select id={`${controlId}-menu-align`} value={menuAlign} onChange={event => setMenuAlign(event.target.value as TextAlignment | 'keep')}>{valueOptions}</select></Field><p>{menuScope === 'field' ? '在字段分配的区域内调整文字对齐。' : menuScope === 'row' ? '将当前行字段作为一组，放在所属栏的左侧、中间或右侧。' : '统一本模块各行的默认对齐，并清除单独的行对齐。模块标题保留模板样式。'} 当前：{currentAlignment ? alignmentLabels[currentAlignment] : '沿用原有排版'}。</p></div>}
        <Field label="目标字段" htmlFor="preview-field-target"><select id="preview-field-target" value={actualTarget} disabled={!candidates.length} onChange={event => setMenuTarget(event.target.value)}>{!candidates.length && <option value="">无其他字段，可单独调整对齐</option>}{candidates.map(field => <option key={field.fieldKey} value={field.fieldKey}>{field.label}</option>)}</select></Field><Field label="放置位置" htmlFor="preview-field-placement"><select id="preview-field-placement" value={actualPlacement} disabled={!candidates.length} onChange={event => setMenuPlacement(event.target.value as FieldDropPlacement)}>{(Object.keys(fieldPlacementLabels) as FieldDropPlacement[]).filter(placement => !richMove || placement === 'above' || placement === 'below').map(placement => <option key={placement} value={placement}>{fieldPlacementLabels[placement]}</option>)}</select></Field><div className="modal-actions"><Button secondary onClick={() => setMenuField(null)}>取消</Button>{alignment && <Button secondary disabled={!enabled || menuAlign === 'keep'} onClick={() => { if (enabled && menuField && menuAlign !== 'keep') alignment.apply({ sectionId: menuField.sectionId, fieldKey: menuField.fieldKey, scope: menuScope, value: menuAlign }); setMenuField(null); }}>仅应用对齐</Button>}<Button disabled={!enabled || !actualTarget} onClick={() => { if (enabled && menuField && actualTarget) onDrop?.({ sectionId: menuField.sectionId, sourceKey: menuField.fieldKey, targetKey: actualTarget, placement: actualPlacement, ...(alignment && menuAlign !== 'keep' ? { alignment: { scope: menuScope, value: menuAlign } } : {}) }); setMenuField(null); }}>移动字段</Button></div></div>
    </Modal>
  </FieldDragContext.Provider>;
}

export function PreviewFieldLayer({ fields, page, scale }: { fields: readonly PreviewFieldRegion[]; page: number; scale: number }) {
  const context = useContext(FieldDragContext), element = useRef<HTMLDivElement>(null);
  const hitAreas = useMemo(() => previewFieldHitAreas(fields, scale), [fields, scale]);
  useEffect(() => { context?.register(page, element.current); return () => context?.register(page, null); }, [page, context?.register, context?.enabled]);
  if (!context?.enabled) return null;
  const hit = context.drag?.hit?.target.page === page ? context.drag.hit : null;
  const marker = hit ? { left: (hit.placement === 'before' ? hit.target.x : hit.placement === 'after' ? hit.target.x + hit.target.width : hit.target.columnX) * scale,
    top: (hit.placement === 'above' ? hit.target.y : hit.placement === 'below' ? hit.target.y + hit.target.height : hit.target.y) * scale,
    width: hit.placement === 'above' || hit.placement === 'below' ? hit.target.columnWidth * scale : 2,
    height: hit.placement === 'before' || hit.placement === 'after' ? Math.max(14, hit.target.height * scale) : 2 } : null;
  return <div ref={element} className="preview-field-layer" data-field-page={page}>
    {fields.map((field, index) => <button type="button" key={`${field.itemId}-${field.fieldKey}-${index}`} className={`preview-field-target ${context.drag?.source.sectionId === field.sectionId && context.drag.source.itemId === field.itemId && context.drag.source.fieldKey === field.fieldKey ? 'is-dragging' : ''}`} aria-label={`拖动${field.label}字段`} title={`拖动${field.label}，或点击调整位置与对齐`} data-preview-field={field.fieldKey} data-preview-item={field.itemId} data-preview-section={field.sectionId} style={hitAreas[index]} onPointerDown={event => context.start(event, field)} onClick={event => { event.stopPropagation(); context.click(field, event.currentTarget); }}><span><GripVertical size={11} />{field.label}</span></button>)}
    {hit && marker && <div className="preview-field-drop-indicator" style={marker}><span style={{ transform: marker.top < 22 ? 'none' : undefined }}>{hit.target.label} · {fieldPlacementLabels[hit.placement]}</span></div>}
  </div>;
}
