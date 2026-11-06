import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, FileText, Info, LoaderCircle, Save, SearchCheck } from 'lucide-react';
import type { Locale, PreviewFieldDrop, Resume } from '../../domain/types';
import { completeness, fieldChecks, snapshotOf } from '../../domain/resume';
import { LOCALES, sectionTitle } from '../../domain/registry';
import { movePreviewField } from '../../domain/fieldDrop';
import { useApp } from '../../app/store';
import { useNavigation } from '../../app/navigation';
import { repository } from '../../persistence/repository';
import { Button, EmptyState, Modal } from '../../components/ui';
import { ContentEditor } from './ContentEditor';
import { LayoutEditor } from '../layout/LayoutEditor';
import { AppearanceEditor } from '../appearance/AppearanceEditor';
import { Templates } from '../appearance/Templates';
import { HtmlPreview } from '../preview/HtmlPreview';
import { usePdf } from '../preview/usePdf';
import { HistoryDialog } from '../history/HistoryDialog';
import { ExportPanel } from '../import-export/ExportPanel';
import { exportBackup, exportHtml, exportImages, exportPdf } from '../import-export/exports';
import { renderPdf } from '../../rendering/client';
import { smartOnePage } from '../../rendering/onePage';
import { ONE_PAGE_FILL_TARGET } from '../../rendering/onePageFill';
import { captureOnePageRestore, restoreOnePageFormat, type OnePageRestore } from '../../rendering/onePageRestore';
import { CloudStatus } from '../../cloud/CloudStatus';
import { StorageChoice } from '../../cloud/AccountUI';
import { accountScope, useCloud } from '../../cloud/account';
import { saveChosenResumes, type StorageLocation } from '../../cloud/sync';
import './editor-settings.css';
import '../preview/preview-mode.css';

const PdfPreview = lazy(() => import('../preview/PdfPreview').then(module => ({ default: module.PdfPreview })));

export function Editor() {
  const { id = '' } = useParams(), navigate = useNavigate(), { mode, setMode } = useNavigation();
  const accountEpoch = useCloud(state => state.epoch);
  const ownershipError = useCloud(state => state.ownershipError);
  const current = useApp(state => state.current), assets = useApp(state => state.assets), saveState = useApp(state => state.saveState), conflict = useApp(state => state.conflict);
  const [conflictLocation, setConflictLocation] = useState<StorageLocation>('local');
  const [loaded, setLoaded] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [checks, setChecks] = useState(false), [conflictOpen, setConflictOpen] = useState(false), [view, setView] = useState('edit'), [retry, setRetry] = useState(0);
  const previewHelpButton = useRef<HTMLButtonElement>(null);
  const [previewHelpOpen, setPreviewHelpOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'html' | 'pdf'>('html');
  const [highlightedTarget, setHighlightedTarget] = useState<string | null>(null);
  const [jumpRequest, setJumpRequest] = useState<{ target: string; sectionTarget?: string } | null>(null);
  const [exporting, setExporting] = useState(false), [exportProgress, setExportProgress] = useState(''), [dpi, setDpi] = useState(150), [fitting, setFitting] = useState(false), [fitProgress, setFitProgress] = useState(''), [fitRestore, setFitRestore] = useState<OnePageRestore | null>(null);
  const exportController = useRef<AbortController | null>(null), fitController = useRef<AbortController | null>(null);
  useEffect(() => { let active = true; setLoaded(false); setMode('content'); setFitRestore(null); void useApp.getState().open(id).then(() => { if (active) setLoaded(true); }); return () => { active = false; }; }, [id, accountEpoch, ownershipError]);
  useEffect(() => { if (conflict) setConflictOpen(true); }, [conflict]);
  useEffect(() => { if (!highlightedTarget) return; const timer = window.setTimeout(() => setHighlightedTarget(null), 2400); return () => window.clearTimeout(timer); }, [highlightedTarget]);
  useLayoutEffect(() => {
    if (!jumpRequest) return;
    const element = jumpRequest.sectionTarget ? Array.from(document.querySelectorAll<HTMLElement>('[data-section-id]')).find(item => item.dataset.sectionId === jumpRequest.sectionTarget) : document.getElementById(jumpRequest.target);
    element?.scrollIntoView({ behavior: 'auto', block: 'center' });
    const field = element?.matches('input,textarea') ? element : element?.querySelector<HTMLElement>('input,textarea,[contenteditable="true"]') ?? element?.querySelector<HTMLElement>('.item-toggle') ?? element?.querySelector<HTMLElement>('button');
    field?.focus({ preventScroll: true });
  }, [jumpRequest]);
  const resume = current?.id === id ? current : null;
  const rendered = usePdf(resume, assets, retry, previewMode === 'pdf');
  if (!loaded) return <main className="workspace-loading"><LoaderCircle className="spin" size={24} />正在打开简历</main>;
  if (!resume) return <main className="home-page"><EmptyState icon={<FileText size={30} />} title="没有找到这份简历" text="它可能已经移入回收站，也可以返回工作区继续制作。" action={<Link className="button primary" to="/">返回工作区</Link>} /></main>;
  const score = completeness(resume), issues = fieldChecks(resume);
  const jump = (target: string, sectionTarget?: string) => { setMode('content'); setView('edit'); setChecks(false); setJumpRequest({ target, sectionTarget }); };
  const jumpFromPreview = (target: string) => { if (target === 'basics' || !resume.sections.some(section => section.id === target)) return; setHighlightedTarget(target); jump('', target); };
  const moveFieldFromPreview = (drop: PreviewFieldDrop) => {
    const section = useApp.getState().current?.sections.find(item => item.id === drop.sectionId);
    if (!section) return;
    const settings = movePreviewField(section, drop.sourceKey, drop.targetKey, drop.placement);
    if (!settings) return;
    useApp.getState().update(next => { const target = next.sections.find(item => item.id === drop.sectionId); if (target) target.contentLayout = settings; });
    useApp.getState().notify({ message: `${sectionTitle(section)}的字段排版已更新` });
    void useApp.getState().flush();
  };
  const runExport = async (kind: 'pdf' | 'images' | 'html') => {
    const snapshot = structuredClone(useApp.getState().current!); const controller = new AbortController(); exportController.current = controller; setExporting(true); setExportProgress(kind === 'pdf' ? '正在生成 PDF…' : kind === 'html' ? '正在准备 HTML…' : '正在准备图片…');
    void useApp.getState().flush();
    try { if (kind === 'pdf') await exportPdf(snapshot, assets, controller.signal); else if (kind === 'html') await exportHtml(snapshot, assets, controller.signal); else await exportImages(snapshot, assets, dpi, controller.signal, (current, total) => setExportProgress(`正在生成第 ${current} / ${total} 张图片`)); if (!controller.signal.aborted) useApp.getState().notify({ message: kind === 'pdf' ? '已开始下载 PDF' : kind === 'html' ? '已开始下载 HTML' : '已开始下载简历图片' }); }
    catch (error) { if (!controller.signal.aborted) useApp.getState().notify({ message: error instanceof Error ? error.message : String(error), error: true }); }
    finally { setExporting(false); exportController.current = null; }
  };
  const fit = async () => {
    if (fitController.current) { fitController.current.abort(); return; }
    const snapshot = structuredClone(useApp.getState().current!);
    const controller = new AbortController(); fitController.current = controller; setFitting(true);
    setFitProgress('正在检查当前简历');
    const applyCandidate = async (candidate: Resume, pages: number, changes: string[], message = `已调整为 ${pages} 页`) => {
      const current = useApp.getState().current;
      if (!current || current.id !== snapshot.id || JSON.stringify(snapshotOf(current)) !== JSON.stringify(snapshotOf(snapshot))) { useApp.getState().notify({ message: '简历已更新，请重新进行智能排版。' }); return; }
      await repository.snapshot(snapshot, '智能一页前');
      const latest = useApp.getState().current;
      if (!latest || latest.id !== snapshot.id || JSON.stringify(snapshotOf(latest)) !== JSON.stringify(snapshotOf(snapshot))) { useApp.getState().notify({ message: '简历已更新，本次排版尚未应用。' }); return; }
      setFitRestore(captureOnePageRestore(snapshot, candidate));
      useApp.getState().update(next => {
        next.appearance = structuredClone(candidate.appearance); next.layout = structuredClone(candidate.layout);
        for (const section of next.sections) { const fitted = candidate.sections.find(item => item.id === section.id); if (fitted?.contentLayout) section.contentLayout = structuredClone(fitted.contentLayout); else delete section.contentLayout; }
      });
      void useApp.getState().flush();
      useApp.getState().notify({ message: `${message}${changes.length ? `：${changes.slice(0, 2).join('；')}` : ''}，可一键还原。` });
    };
    try {
      const result = await smartOnePage(snapshot, candidate => renderPdf(candidate, assets, controller.signal), { signal: controller.signal, onProgress: (message, attempts) => { if (!controller.signal.aborted) setFitProgress(`${message} · 已检查 ${attempts} 种排版`); } });
      if (result.status === 'already') { useApp.getState().notify({ message: result.usage === undefined ? '填写经历后，可以智能排满一页。' : result.usage >= ONE_PAGE_FILL_TARGET ? '当前简历已充分利用一页空间。' : '当前内容较少，已保留现有的一页排版。' }); return; }
      if (result.status === 'fit' || result.status === 'filled') await applyCandidate(result.resume, 1, result.changes, result.status === 'filled' ? result.fill?.complete ? '已智能撑满一页' : '内容较少，已舒展一页排版' : result.fill?.complete ? '已调整为一页并铺满' : '已调整为 1 页');
      else useApp.getState().notify({ message: `已检查 ${result.attempts} 种排版，最紧凑的结果为 ${result.pages} 页。原版已保留。`, action: { label: `采用 ${result.pages} 页紧凑版`, run: () => applyCandidate(result.resume, result.pages, result.changes) } });
    } catch (error) { useApp.getState().notify(controller.signal.aborted ? { message: '已取消智能一页，原排版已保留。' } : { message: error instanceof Error ? error.message : String(error), error: true }); }
    finally { fitController.current = null; setFitting(false); setFitProgress(''); }
  };
  const previewControls = <div className="preview-heading-controls"><div className="segmented preview-mode-switch" role="group" aria-label="预览模式"><button type="button" aria-pressed={previewMode === 'html'} className={previewMode === 'html' ? 'active' : ''} onClick={() => setPreviewMode('html')}>即时预览</button><button type="button" aria-pressed={previewMode === 'pdf'} className={previewMode === 'pdf' ? 'active' : ''} onClick={() => setPreviewMode('pdf')}>精确 PDF</button></div><button ref={previewHelpButton} type="button" className="icon-button" aria-label="预览模式说明" title="预览模式说明" onClick={() => setPreviewHelpOpen(true)}><Info size={15} /></button></div>;
  const previewActions = { headingControls: previewControls, onPdf: () => void runExport('pdf'), onPng: () => void runExport('images'), onFit: () => void fit(), fitting, fitProgress, exporting, onSectionSelect: jumpFromPreview, onUndoFit: fitRestore ? () => { useApp.getState().update(next => { const restored = restoreOnePageFormat(next, fitRestore); next.appearance = restored.appearance; next.layout = restored.layout; next.sections = restored.sections; }); setFitRestore(null); void useApp.getState().flush(); useApp.getState().notify({ message: '已还原智能排版前的布局和间距，内容编辑已保留。' }); } : undefined };
  return <main className={`editor-shell view-${view}`}><header className="editor-topbar"><input className="resume-title-input" aria-label="简历名称" value={resume.title} onChange={event => useApp.getState().update(next => { next.title = event.target.value; })} placeholder="未命名简历" /><span className={`save-indicator ${saveState}`} role="status">{saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : saveState === 'failed' || saveState === 'conflict' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}<span>{saveState === 'saved' ? '已保存在本地' : saveState === 'saving' ? '保存中' : saveState === 'failed' ? '保存失败' : saveState === 'conflict' ? '有版本冲突' : '待保存'}</span></span><CloudStatus localId={resume.id} /><div className="topbar-spacer" /><select className="locale-select" aria-label="简历语言" value={resume.locale} onChange={event => useApp.getState().update(next => { next.locale = event.target.value as Locale; })}>{LOCALES.map(locale => <option value={locale.value} key={locale.value}>{locale.label}</option>)}</select><Button secondary aria-label="历史记录" onClick={() => setHistoryOpen(true)}><Clock size={15} /><span>历史记录</span></Button><Button secondary aria-label="保存" disabled={saveState === 'saving'} onClick={async () => { if (await useApp.getState().flush()) useApp.getState().notify({ message: '当前内容已保存' }); }}><Save size={15} /><span>保存</span></Button></header>
    <div className="mobile-view-tabs"><button type="button" className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>编辑</button><button type="button" className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>预览</button></div><div className="editor-panel"><div className="completeness compact-completeness"><span>完整度 <strong>{score.score}%</strong></span><div className="completeness-track" aria-hidden="true"><span style={{ width: `${score.score}%` }} /></div><button type="button" className="check-button" onClick={() => setChecks(true)}><SearchCheck size={14} />检查简历{issues.length > 0 && <span className="check-count">{issues.length}</span>}</button></div>
      {(saveState === 'failed' || saveState === 'conflict') && <div className="save-warning" role="alert"><AlertCircle size={16} /><span>{saveState === 'conflict' ? '另一个标签页有更新，当前修改已保留。' : '当前修改还未保存，仍可下载备份。'}</span><button type="button" onClick={() => saveState === 'conflict' ? setConflictOpen(true) : void useApp.getState().flush()}>{saveState === 'conflict' ? '处理冲突' : '重试保存'}</button></div>}
      <div className="panel-content"><div hidden={mode !== 'content'}><ContentEditor resume={resume} highlightedTarget={highlightedTarget} /></div>{mode === 'layout' && <LayoutEditor resume={resume} />}{mode === 'templates' && <Templates resume={resume} />}{mode === 'appearance' && <AppearanceEditor resume={resume} />}{mode === 'export' && <ExportPanel resume={resume} dpi={dpi} onDpi={setDpi} onPdf={() => void runExport('pdf')} onHtml={() => void runExport('html')} onImages={() => void runExport('images')} busy={exporting} progress={exportProgress} onCancel={() => exportController.current?.abort()} />}</div>
    </div><div className="preview-pane"><Suspense fallback={<div className="preview-mode-loading" role="status"><LoaderCircle className="spin" size={20} />正在打开 PDF 校对</div>}>{previewMode === 'html' ? <HtmlPreview resume={resume} assets={assets} {...previewActions} /> : <PdfPreview {...rendered} {...previewActions} title="预览" onRetry={() => setRetry(value => value + 1)} onFieldDrop={moveFieldFromPreview} />}</Suspense></div>
    <Modal open={previewHelpOpen} onClose={() => { setPreviewHelpOpen(false); requestAnimationFrame(() => previewHelpButton.current?.focus()); }} title="预览模式" description="编辑时查看即时预览，导出前用精确 PDF 核对。"><div className="modal-body preview-mode-help"><h3>即时预览</h3><p>先显示内容并按 A4 分页，所选字体加载后自动更新。字体和分页可能与导出不同。</p><h3>精确 PDF</h3><p>使用导出时的字体和 A4 分页，可开启“拖动布局”调整字段。首次使用所选字体时需要等待加载。</p><p>两种模式都可直接下载 PDF。</p></div></Modal>
    <HistoryDialog key={resume.id} open={historyOpen} onClose={() => setHistoryOpen(false)} resume={resume} /><Modal open={checks} onClose={() => setChecks(false)} title="检查简历" description="按当前内容检查缺项与格式，建议不会阻止保存或备份。"><div className="modal-body">{issues.length ? <div className="check-list">{issues.map((issue, index) => <button type="button" key={index} onClick={() => jump(issue.target)}><span>{issue.label}</span>{issue.points && <small>可提升 {issue.points}%</small>}</button>)}</div> : <p className="check-success"><CheckCircle2 size={18} />主要信息与联系格式完整</p>}{rendered.error && <p className="field-error">{rendered.error}</p>}</div></Modal>
    <Modal open={Boolean(conflict) && conflictOpen} onClose={() => setConflictOpen(false)} title="另一个标签页更新了简历" description="当前修改已保留。你可以另存为新简历，也可以加载最新版本。"><div className="modal-body"><StorageChoice value={conflictLocation} onChange={setConflictLocation} /><div className="conflict-options"><Button onClick={async () => { const owner = accountScope().userId; const copy = await useApp.getState().resolveConflict('copy'); if (copy) { const result = await saveChosenResumes([copy], conflictLocation, owner); if (result.failed) useApp.getState().notify({ message: '本机副本已保留，云端保存未成功，请在云端简历页重试。', error: true }); setConflictOpen(false); navigate(`/resume/${copy.id}`); } }}>保留我的修改为新简历</Button><Button secondary onClick={async () => { await useApp.getState().resolveConflict('latest'); setConflictOpen(false); }}>加载最新版本</Button><Button secondary onClick={() => void exportBackup([resume], false, assets)}>下载我的草稿备份</Button></div></div></Modal>
  </main>;
}
