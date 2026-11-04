import { useEffect, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import type { Appearance, Resume } from '../../domain/types';
import { DEFAULT_APPEARANCE, DENSITIES } from '../../domain/registry';
import { useApp } from '../../app/store';
import { Button, Field, Modal, Toggle } from '../../components/ui';
import { avatarFrame } from '../../domain/avatar';
import { defaultAppearanceForTemplate } from '../../domain/resume';
import { THEME_COLOR_GROUPS } from '../../domain/colors';
import { FONT_OPTIONS, fontOptionFor } from '../../domain/fonts';
import './appearance.css';
import './fonts.css';

function RangeSetting({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) { const id = `setting-${label}`; return <div className="range-setting"><label htmlFor={id}>{label}<span>{Number(value.toFixed(2))}{unit}</span></label><div><input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={Number(value.toFixed(2))} onChange={event => { const n = Number(event.target.value); if (event.target.value && n >= min && n <= max) onChange(n); }} /></div></div>; }
export function AppearanceEditor({ resume }: { resume: Resume }) {
  const update = useApp(state => state.update), [reset, setReset] = useState(false), [customColor, setCustomColor] = useState(resume.appearance.themeColor);
  const appearance = resume.appearance;
  const selectedFont = fontOptionFor(appearance.fontFamilyId);
  const selectedColor = THEME_COLOR_GROUPS.flatMap(group => [...group.colors]).find(color => color.hex === appearance.themeColor.toUpperCase());
  useEffect(() => { setCustomColor(appearance.themeColor); }, [appearance.themeColor]);
  const avatar = avatarFrame(appearance.avatar);
  const selectedDensity = appearance.density !== 'custom' && Object.entries(DENSITIES[appearance.density]).every(([key, value]) => appearance[key as keyof typeof DENSITIES.standard] === value) ? appearance.density : 'custom';
  const set = (patch: Partial<Appearance>) => update(next => { next.appearance = { ...next.appearance, ...patch }; });
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
      <RangeSetting label="行高" value={appearance.lineHeight} min={1.1} max={2} step={.05} onChange={value => set({ lineHeight: value, density: 'custom' })} />
      <RangeSetting label="段落与模块留白" value={appearance.spacingScale ?? 1} min={.45} max={3} step={.05} unit=" 倍" onChange={spacingScale => set({ spacingScale, density: 'custom' })} />
      <RangeSetting label="外边距" value={appearance.marginPx} min={8} max={96} unit=" px" onChange={value => set({ marginPx: value, density: 'custom' })} />
      <p className="helper-text">当前约 {(appearance.marginPx * 25.4 / 96).toFixed(1)} mm；沿用 TalenCat 预设：紧凑 14px、标准 18px、宽松 24px。</p>
      <RangeSetting label="列间距" value={appearance.columnGapPx} min={8} max={40} unit=" px" onChange={value => set({ columnGapPx: value })} />
    </div><div className="setting-block"><h3>显示选项</h3>{([{ key: 'pageNumbers', label: '显示页码' }, { key: 'hideIcons', label: '隐藏联系信息图标' }, { key: 'underlineLinks', label: '链接下划线' }] as const).map(option => <div className="setting-row" key={option.key}><span>{option.label}</span><Toggle label={option.label} checked={appearance[option.key]} onChange={checked => set({ [option.key]: checked })} /></div>)}</div>
    <div className="setting-block"><h3>头像外观</h3><div className="setting-row"><span>显示头像</span><Toggle label="页面设置显示头像" checked={avatar.visible} onChange={visible => setAvatar({ visible })} /></div><Field label="头像比例" htmlFor="avatar-frame-aspect"><select id="avatar-frame-aspect" value={avatar.aspectRatio} onChange={event => setAvatar({ aspectRatio: Number(event.target.value) })}>{![1, .75, 4 / 3].includes(avatar.aspectRatio) && <option value={avatar.aspectRatio}>当前长方形比例</option>}<option value={.75}>3 : 4 · 证件照长方形</option><option value={4 / 3}>4 : 3 · 横向长方形</option><option value={1}>1 : 1 · 直角方形</option></select></Field><RangeSetting label="头像大小" value={avatar.widthPx} min={32} max={160} unit=" px" onChange={widthPx => setAvatar({ widthPx })} /><RangeSetting label="头像边框" value={avatar.borderWidthPx} min={0} max={6} unit=" px" onChange={borderWidthPx => setAvatar({ borderWidthPx })} /><Field label="边框颜色"><input type="color" aria-label="头像边框颜色" value={avatar.borderColor} onChange={event => setAvatar({ borderColor: event.target.value.toUpperCase() })} /></Field></div>
    <Button secondary onClick={() => setReset(true)}><RotateCcw size={15} />恢复默认排版</Button>
  </section><Modal open={reset} onClose={() => setReset(false)} title="恢复默认排版？" description="字体、颜色和间距会回到当前模板的默认值，填写的内容与布局顺序保持原样。"><div className="modal-body"><div className="modal-actions"><Button secondary onClick={() => setReset(false)}>取消</Button><Button onClick={() => { const templateId = appearance.templateId; const avatar = { ...DEFAULT_APPEARANCE.avatar, visible: appearance.avatar.visible, crop: appearance.avatar.crop }; set({ ...defaultAppearanceForTemplate(templateId), avatar }); setReset(false); }}>恢复默认</Button></div></div></Modal></div>;
}
