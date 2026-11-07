import { useEffect, useId, useState } from 'react';
import { ChevronDown, Palette, RotateCcw } from 'lucide-react';
import type { Appearance, Resume } from '../../domain/types';
import { DEFAULT_APPEARANCE, DENSITIES } from '../../domain/registry';
import { useApp } from '../../app/store';
import { Button, Field, Modal, Toggle } from '../../components/ui';
import { avatarFrame } from '../../domain/avatar';
import { defaultAppearanceForTemplate } from '../../domain/resume';
import { THEME_COLOR_GROUPS } from '../../domain/colors';
import { FONT_OPTIONS, fontOptionFor } from '../../domain/fonts';
import { resumeTypeSize } from '../../domain/typography';
import { customFieldSize, resetResumeFontSizes, updatePageAppearance } from '../../domain/typographyBinding';
import { usePreviewFont } from '../preview/usePreviewFont';
import './appearance.css';
import './disclosure.css';
import './fonts.css';
import './typography-binding.css';

function RangeSetting({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) { const id = `setting-${label}`; return <div className="range-setting"><label htmlFor={id}>{label}<span>{Number(value.toFixed(2))}{unit}</span></label><div><input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={Number(value.toFixed(2))} onChange={event => { const n = Number(event.target.value); if (event.target.value && n >= min && n <= max) onChange(n); }} /></div></div>; }
export function AppearanceEditor({ resume }: { resume: Resume }) {
  const summaryId = useId();
  const update = useApp(state => state.update), [reset, setReset] = useState(false), [customColor, setCustomColor] = useState(resume.appearance.themeColor);
  const appearance = resume.appearance;
  const [unifyOpen, setUnifyOpen] = useState(false), [unifying, setUnifying] = useState(false);
  const customSizes = resume.sections.flatMap(section => section.contentLayout?.fields ?? []).filter(customFieldSize).length;
  const sampleFont = usePreviewFont(appearance.fontFamilyId, '模块标题条目标题正文内容');
  const selectedFont = fontOptionFor(appearance.fontFamilyId);
  const selectedColor = THEME_COLOR_GROUPS.flatMap(group => [...group.colors]).find(color => color.hex === appearance.themeColor.toUpperCase());
  useEffect(() => { setCustomColor(appearance.themeColor); }, [appearance.themeColor]);
  const avatar = avatarFrame(appearance.avatar);
  const layoutSummary = `边距 ${appearance.marginPx}px · 留白 ${Number((appearance.spacingScale ?? 1).toFixed(2))} 倍 · ${appearance.pageNumbers ? '显示页码' : '隐藏页码'}`;
  const avatarSummary = `${resume.basics.avatarAssetId ? avatar.visible ? '已显示' : '已隐藏' : '未设置照片'} · ${avatar.widthPx} × ${Number((avatar.widthPx / avatar.aspectRatio).toFixed(1))}px`;
  const selectedDensity = appearance.density !== 'custom' && Object.entries(DENSITIES[appearance.density]).every(([key, value]) => appearance[key as keyof typeof DENSITIES.standard] === value) ? appearance.density : 'custom';
  const set = (patch: Partial<Appearance>) => update(next => updatePageAppearance(next, patch));
  const unifySizes = async () => {
    setUnifying(true);
    const before = resume.sections.map(section => ({ id: section.id, fields: section.contentLayout?.fields.map(field => ({ key: field.key, fontSizePx: field.fontSizePx, fontSizeRatio: field.fontSizeRatio })) ?? [] }));
    try {
      if (!(await useApp.getState().tracked('统一字号层级前', next => { if (next.id === resume.id) resetResumeFontSizes(next); }))) return;
      setUnifyOpen(false);
      useApp.getState().notify({ message: '全篇字段已跟随统一字号层级', action: { label: '撤销', run: () => update(next => {
        if (next.id !== resume.id) return;
        for (const saved of before) for (const field of next.sections.find(section => section.id === saved.id)?.contentLayout?.fields ?? []) {
          const original = saved.fields.find(item => item.key === field.key); if (!original) continue;
          delete field.fontSizePx; delete field.fontSizeRatio;
          if (original.fontSizePx !== undefined) {
            if (next.appearance.fontSizePx === appearance.fontSizePx) field.fontSizePx = original.fontSizePx;
            else field.fontSizeRatio = original.fontSizePx / appearance.fontSizePx;
          }
          if (original.fontSizeRatio !== undefined) field.fontSizeRatio = original.fontSizeRatio;
        }
      }) } });
      await useApp.getState().flush();
    } finally { setUnifying(false); }
  };
  const setAvatar = (patch: Partial<Appearance['avatar']>) => update(next => { next.appearance.avatar = { ...avatarFrame(next.appearance.avatar), ...patch, radiusPx: 0 }; });
  return <div className="appearance-panel"><section className="section-card"><div className="panel-heading"><div><h2>页面设置</h2><p>调整颜色、字体与版面密度。</p></div></div>
    <div className="setting-block"><h3><Palette size={16} />主题色</h3>
      <div className="theme-palette">{THEME_COLOR_GROUPS.map(group => <div className="theme-palette-group" key={group.label} role="group" aria-label={group.label}><span className="theme-palette-label">{group.label}</span><div className="color-swatches">{group.colors.map(color => <button type="button" key={color.hex} className={appearance.themeColor.toUpperCase() === color.hex ? 'selected' : ''} style={{ backgroundColor: color.hex }} aria-label={`主题色 ${color.name} ${color.hex}`} title={`${color.name} · ${color.hex}`} aria-pressed={appearance.themeColor.toUpperCase() === color.hex} onClick={() => set({ themeColor: color.hex })} />)}</div></div>)}</div>
      <div className="custom-color"><input type="color" aria-label="自定义主题色" value={appearance.themeColor} onChange={event => set({ themeColor: event.target.value.toUpperCase() })} /><input type="text" aria-label="主题色 HEX" value={customColor} maxLength={7} spellCheck={false} onBlur={() => setCustomColor(appearance.themeColor)} onChange={event => { const value = event.target.value.toUpperCase(); setCustomColor(value); if (/^#[\dA-F]{6}$/.test(value)) set({ themeColor: value }); }} /></div>
      <p className="theme-color-current">当前：{selectedColor?.name ?? '自定义颜色'} · {appearance.themeColor.toUpperCase()}</p>
    </div>
    <div className="setting-block"><h3>字体与间距</h3><Field label="版面密度"><div className="segmented">{([['compact', '紧凑'], ['standard', '标准'], ['loose', '宽松']] as const).map(([value, name]) => <button type="button" key={value} className={selectedDensity === value ? 'active' : ''} onClick={() => set({ ...DENSITIES[value], spacingScale: 1, density: value })}>{name}</button>)}</div>{selectedDensity === 'custom' && <span className="helper-text">当前使用自定义间距</span>}</Field>
      <Field label="简历字体" htmlFor="resume-font"><select id="resume-font" value={appearance.fontFamilyId} onChange={event => set({ fontFamilyId: event.target.value })}>{FONT_OPTIONS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select><div className="resume-font-preview" aria-label="当前简历字体预览" style={{ fontFamily: selectedFont.cssFamily }}><strong>让经历清晰呈现</strong><span>专业技能 · 工作经历 · Resume &amp; Portfolio</span></div><p className="helper-text font-description">{selectedFont.description}</p></Field>
      <RangeSetting label="字体大小" value={appearance.fontSizePx} min={10} max={24} step={.25} unit=" px" onChange={value => set({ fontSizePx: value, density: 'custom' })} />
      <div className="typography-binding" aria-label="字号联动"><p>这是正文基准，模块内字号会按比例一起缩放。</p><div className="typography-scale-samples" style={{ fontFamily: sampleFont }}>{([{ role: 'section', name: '模块标题' }, { role: 'entry', name: '条目标题' }, { role: 'body', name: '正文内容' }] as const).map(item => <div key={item.role}><span style={{ fontSize: resumeTypeSize(appearance.fontSizePx, item.role), fontWeight: item.role === 'body' ? 400 : 700 }}>{item.name}</span><small>{Number(resumeTypeSize(appearance.fontSizePx, item.role).toFixed(2))}px</small></div>)}</div><div className="typography-binding-actions"><span>{customSizes ? `${customSizes} 个字段有自定义字号比例` : '全篇跟随统一字号层级'}</span><button type="button" className="text-button" disabled={!customSizes} onClick={() => setUnifyOpen(true)}>统一全篇字号</button></div></div>
      <RangeSetting label="行高" value={appearance.lineHeight} min={1.1} max={2} step={.05} onChange={value => set({ lineHeight: value, density: 'custom' })} />
    </div>
    <details className="appearance-disclosure">
      <summary aria-label="更多排版设置" aria-describedby={`${summaryId}-layout`}><span><strong>更多排版设置</strong><small id={`${summaryId}-layout`}>{layoutSummary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="appearance-disclosure-body">
      <RangeSetting label="段落与模块留白" value={appearance.spacingScale ?? 1} min={.45} max={3} step={.05} unit=" 倍" onChange={spacingScale => set({ spacingScale, density: 'custom' })} />
      <RangeSetting label="外边距" value={appearance.marginPx} min={8} max={96} unit=" px" onChange={value => set({ marginPx: value, density: 'custom' })} />
      <p className="helper-text appearance-margin-note">当前约 {(appearance.marginPx * 25.4 / 96).toFixed(1)} mm。紧凑 14px、标准 18px、宽松 24px。</p>
      {resume.layout.mode === 'double' && <RangeSetting label="列间距" value={appearance.columnGapPx} min={8} max={40} unit=" px" onChange={value => set({ columnGapPx: value })} />}
      <div className="appearance-disclosure-options"><h3>显示选项</h3>{([{ key: 'pageNumbers', label: '显示页码' }, { key: 'hideIcons', label: '隐藏联系信息图标' }, { key: 'underlineLinks', label: '链接下划线' }] as const).map(option => <div className="setting-row" key={option.key}><span>{option.label}</span><Toggle label={option.label} checked={appearance[option.key]} onChange={checked => set({ [option.key]: checked })} /></div>)}</div>
      </div>
    </details>
    <details className="appearance-disclosure">
      <summary aria-label="头像外观" aria-describedby={`${summaryId}-avatar`}><span><strong>头像外观</strong><small id={`${summaryId}-avatar`}>{avatarSummary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="appearance-disclosure-body">
        {!resume.basics.avatarAssetId && <p className="helper-text appearance-photo-note">可在简历内容的基本信息中上传照片。</p>}
        <div className="setting-row"><span>显示头像</span><Toggle label="页面设置显示头像" checked={avatar.visible} onChange={visible => setAvatar({ visible })} /></div><Field label="头像比例" htmlFor="avatar-frame-aspect"><select id="avatar-frame-aspect" value={avatar.aspectRatio} onChange={event => setAvatar({ aspectRatio: Number(event.target.value) })}>{![1, .75, 4 / 3].includes(avatar.aspectRatio) && <option value={avatar.aspectRatio}>当前长方形比例</option>}<option value={.75}>3 : 4 · 证件照长方形</option><option value={4 / 3}>4 : 3 · 横向长方形</option><option value={1}>1 : 1 · 直角方形</option></select></Field><RangeSetting label="头像大小" value={avatar.widthPx} min={32} max={160} unit=" px" onChange={widthPx => setAvatar({ widthPx })} /><RangeSetting label="头像边框" value={avatar.borderWidthPx} min={0} max={6} unit=" px" onChange={borderWidthPx => setAvatar({ borderWidthPx })} /><Field label="边框颜色"><input type="color" aria-label="头像边框颜色" value={avatar.borderColor} onChange={event => setAvatar({ borderColor: event.target.value.toUpperCase() })} /></Field>
      </div>
    </details>
    <div className="appearance-reset"><Button secondary onClick={() => setReset(true)}><RotateCcw size={15} />恢复默认排版</Button></div>
  </section><Modal open={unifyOpen} onClose={() => setUnifyOpen(false)} title="统一全篇字号？" description={`将 ${customSizes} 个自定义字段字号恢复为统一层级：条目标题按正文的 18 / 14 倍显示，其余正文跟随页面字号。字段顺序、内容和其他格式保留。`} disableClose={unifying}><div className="modal-body"><div className="modal-actions"><Button secondary disabled={unifying} onClick={() => setUnifyOpen(false)}>取消</Button><Button loading={unifying} onClick={() => void unifySizes()}>统一字号</Button></div></div></Modal><Modal open={reset} onClose={() => setReset(false)} title="恢复默认排版？" description="字体、颜色和间距会回到当前模板的默认值，填写的内容与布局顺序保持原样。"><div className="modal-body"><div className="modal-actions"><Button secondary onClick={() => setReset(false)}>取消</Button><Button onClick={() => { const templateId = appearance.templateId; const avatar = { ...DEFAULT_APPEARANCE.avatar, visible: appearance.avatar.visible, crop: appearance.avatar.crop }; set({ ...defaultAppearanceForTemplate(templateId), avatar }); setReset(false); }}>恢复默认</Button></div></div></Modal></div>;
}
