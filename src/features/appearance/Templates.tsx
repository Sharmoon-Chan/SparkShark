import { useState } from 'react';
import { Check, ImageOff } from 'lucide-react';
import type { Resume } from '../../domain/types';
import { TEMPLATES } from '../../domain/registry';
import { applyTemplate } from '../../domain/resume';
import { useApp } from '../../app/store';
import { templatePreviewFor } from './templatePreviews';
import './templates.css';

type TemplateFilter = 'all' | 'single' | 'double';

function TemplateCard({ template, selected, onSelect }: { template: typeof TEMPLATES[number]; selected: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false);
  const image = templatePreviewFor(template.id);
  return <button type="button" className={`template-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-label={`应用${template.name}模板`} aria-pressed={selected}>
    <div className="template-paper">
      {image && !failed ? <img src={image} alt={`${template.name}模板示意图`} width={480} height={679} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <div className="template-loading template-preview-error"><ImageOff size={20} aria-hidden="true" /><span>示意图暂不可用</span><small>仍可选择此模板</small></div>}
      {selected && <span className="template-check"><Check size={15} aria-hidden="true" /></span>}
    </div>
    <div className="template-caption"><strong>{template.name}</strong><small>{template.mode === 'single' ? '单栏' : '双栏'}</small></div>
  </button>;
}

export function Templates({ resume }: { resume: Resume }) {
  const update = useApp(state => state.update);
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const visible = TEMPLATES.filter(template => filter === 'all' || template.mode === filter);
  const current = TEMPLATES.find(template => template.id === resume.appearance.templateId) ?? TEMPLATES[0];
  const filters: { id: TemplateFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: TEMPLATES.length },
    { id: 'single', label: '单栏', count: TEMPLATES.filter(template => template.mode === 'single').length },
    { id: 'double', label: '双栏', count: TEMPLATES.filter(template => template.mode === 'double').length },
  ];
  return <section className="section-card template-browser">
    <div className="template-browser-heading"><h2>风格模板</h2><span className="template-current" role="status" aria-live="polite">已选 · {current.name}</span></div>
    <div className="template-filters" role="group" aria-label="按栏数筛选模板">{filters.map(item => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span className="template-filter-count">{item.count}</span></button>)}</div>
    <div className="template-grid">{visible.map(template => <TemplateCard key={template.id} template={template} selected={resume.appearance.templateId === template.id} onSelect={() => { if (resume.appearance.templateId !== template.id) update(next => Object.assign(next, applyTemplate(next, template.id))); }} />)}</div>
  </section>;
}
