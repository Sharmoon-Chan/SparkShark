import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Asset, Resume } from '../../domain/types';
import { TEMPLATES } from '../../domain/registry';
import { applyTemplate, snapshotOf } from '../../domain/resume';
import { useApp } from '../../app/store';
import { renderPdf, thumbnail } from '../../rendering/client';
import { useObjectUrl } from '../../components/ui';
import './templates.css';

type TemplateFilter = 'all' | 'single' | 'double';
type Preview = { status: 'queued' | 'loading' | 'ready' | 'error'; image?: Blob; error?: string };
type PreviewState = { signature: string; previews: Record<string, Preview> };

function TemplateCard({ template, selected, preview, onSelect }: { template: typeof TEMPLATES[number]; selected: boolean; preview?: Preview; onSelect: () => void }) {
  const url = useObjectUrl(preview?.image);
  const failed = preview?.status === 'error';
  return <button type="button" className={`template-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-label={`应用${template.name}模板`} aria-pressed={selected} title={failed ? preview.error : undefined}>
    <div className="template-paper">
      {url ? <img src={url} alt={`${template.name}模板的当前简历预览`} loading="lazy" decoding="async" /> : <div className={`template-loading ${failed ? 'template-preview-error' : ''}`}>
        {failed ? <CircleAlert size={20} aria-hidden="true" /> : <LoaderCircle size={20} className={preview?.status === 'loading' ? 'spin' : ''} aria-hidden="true" />}
        <span>{failed ? '预览暂时不可用' : preview?.status === 'loading' ? '正在生成预览' : '等待生成预览'}</span>
        {failed && <small>仍可应用此模板</small>}
      </div>}
      {selected && <span className="template-check"><Check size={15} aria-hidden="true" /></span>}
      {template.reference && <span className="template-reference">适配版</span>}
    </div>
    <div className="template-caption"><strong>{template.name}</strong><small>{template.subtitle}</small></div>
  </button>;
}

export function Templates({ resume, assets }: { resume: Resume; assets: Record<string, Asset> }) {
  const update = useApp(state => state.update);
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<PreviewState>({ signature: '', previews: {} });
  const imageCache = useRef(new Map<string, Blob>());
  const previousAssets = useRef(assets);
  const priority = useRef({ filter, selected: resume.appearance.templateId });
  priority.current = { filter, selected: resume.appearance.templateId };

  const resumeSignature = JSON.stringify(snapshotOf(resume));
  const candidates = useMemo(() => TEMPLATES.map(template => {
    const candidate = applyTemplate(resume, template.id);
    return { template, resume: candidate, key: JSON.stringify(snapshotOf(candidate)) };
  }), [resumeSignature]);
  const signature = JSON.stringify(candidates.map(candidate => candidate.key));

  useEffect(() => {
    const controller = new AbortController();
    if (previousAssets.current !== assets) { imageCache.current.clear(); previousAssets.current = assets; }
    const initial: Record<string, Preview> = {};
    const pending = candidates.filter(candidate => {
      const image = imageCache.current.get(candidate.key);
      initial[candidate.template.id] = image ? { status: 'ready', image } : { status: 'queued' };
      return !image;
    });
    setState({ signature, previews: initial });
    const setPreview = (id: string, preview: Preview) => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, previews: { ...previous.previews, [id]: preview } }));
    };
    void (async () => {
      while (pending.length && !controller.signal.aborted) {
        // Prioritize the selected card and whichever filter is currently visible.
        const selected = pending.findIndex(candidate => candidate.template.id === priority.current.selected);
        const visible = pending.findIndex(candidate => priority.current.filter === 'all' || candidate.template.mode === priority.current.filter);
        const [candidate] = pending.splice(selected >= 0 ? selected : visible >= 0 ? visible : 0, 1);
        const { template, key } = candidate;
        setPreview(template.id, { status: 'loading' });
        try {
          const result = await renderPdf(candidate.resume, assets, controller.signal);
          if (controller.signal.aborted) break;
          const image = await thumbnail(result.bytes);
          if (controller.signal.aborted) break;
          imageCache.current.set(key, image);
          // Retain recent complete sets so switching templates can reuse their real previews.
          while (imageCache.current.size > TEMPLATES.length * 2) imageCache.current.delete(imageCache.current.keys().next().value!);
          setPreview(template.id, { status: 'ready', image });
        } catch (error) {
          if (controller.signal.aborted) break;
          setPreview(template.id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => controller.abort();
  }, [signature, assets, retry]);

  const previews = state.signature === signature ? state.previews : {};
  const visible = TEMPLATES.filter(template => filter === 'all' || template.mode === filter);
  const current = TEMPLATES.find(template => template.id === resume.appearance.templateId) ?? TEMPLATES[0];
  const ready = visible.filter(template => previews[template.id]?.status === 'ready').length;
  const failed = visible.filter(template => previews[template.id]?.status === 'error');
  const pending = visible.length - ready - failed.length;
  const adapted = TEMPLATES.filter(template => template.reference).length;
  const filters: { id: TemplateFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: TEMPLATES.length },
    { id: 'single', label: '单栏', count: TEMPLATES.filter(template => template.mode === 'single').length },
    { id: 'double', label: '双栏', count: TEMPLATES.filter(template => template.mode === 'double').length },
  ];

  return <section className="section-card template-browser">
    <div className="panel-heading"><div><h2>风格模板</h2><p>{TEMPLATES.length} 种排版，包含 {adapted} 款参考适配版。切换保留全部内容。</p></div></div>
    <div className="template-current"><Check size={14} aria-hidden="true" /><span>当前：<strong>{current.name}</strong></span><small>{current.mode === 'single' ? '单栏' : '双栏'}</small></div>
    <div className="segmented template-filters" role="group" aria-label="按栏数筛选模板">{filters.map(item => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span className="template-filter-count">{item.count}</span></button>)}</div>
    <div className="template-preview-status" role="status" aria-live="polite">
      <span>{pending ? `预览已生成 ${ready} / ${visible.length}` : failed.length ? `${ready} 款预览可用` : `${visible.length} 款模板可选`}</span>
      {pending > 0 && <small>可在生成过程中选择模板</small>}
    </div>
    {failed.length > 0 && <div className="template-error-notice"><div><CircleAlert size={14} aria-hidden="true" /><span>{failed.length} 款预览生成失败，可重试。{!pending && failed[0] && <small>{previews[failed[0].id]?.error}</small>}</span></div><button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}><RotateCcw size={13} aria-hidden="true" />重试预览</button></div>}
    <div className="template-grid">{visible.map(template => <TemplateCard key={template.id} template={template} preview={previews[template.id]} selected={resume.appearance.templateId === template.id} onSelect={() => update(next => Object.assign(next, applyTemplate(next, template.id)))} />)}</div>
    <p className="helper-text">预览使用当前简历内容。模板会应用对应的字体、配色与分栏，之后可在页面设置中继续调整。</p>
  </section>;
}
