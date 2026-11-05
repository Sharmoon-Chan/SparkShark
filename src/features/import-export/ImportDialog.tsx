import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileJson, FileText, Upload, LoaderCircle, Eye } from 'lucide-react';
import type { BackupEnvelope, Locale } from '../../domain/types';
import { LOCALES } from '../../domain/registry';
import { base64ToBytes, bytesBlob, bytesToBase64, repository, sha256 } from '../../persistence/repository';
import { imageFromBlob, normalizePhoto } from '../../persistence/media';
import { useApp } from '../../app/store';
import { Button, Field, Modal, Toggle, useObjectUrl } from '../../components/ui';
import { PdfPreview } from '../preview/PdfPreview';
import { parseBackup, parseText, resumeFromText, type TextCandidate } from './parsers';
import { readPdfResume, type ImportedPhoto, type PdfImportResult } from './pdfImport';
import type { DocxImportResult } from './docxImport';
import { CandidateReview } from './CandidateReview';
import { uid } from '../../domain/resume';
import { StorageChoice } from '../../cloud/AccountUI';
import { accountScope } from '../../cloud/account';
import { saveChosenResumes, type StorageLocation } from '../../cloud/sync';

type ImportMode = 'pdf' | 'docx' | 'backup' | 'text';
const modes = [['pdf', 'PDF 简历'], ['docx', 'Word 文档'], ['backup', 'JSON 备份'], ['text', '文本 / Markdown']] as const;
const formats: Record<ImportMode, string> = {
  pdf: '带文字的 PDF 简历 · 最大 10 MB', docx: 'Word DOCX 文档 · 最大 10 MB',
  backup: 'SparkShark JSON 备份 · 最大 20 MB', text: 'TXT / Markdown · 最大 1 MB',
};

export function ImportDialog({ open, onClose, initial = 'pdf' }: { open: boolean; onClose: () => void; initial?: ImportMode }) {
  const navigate = useNavigate(), input = useRef<HTMLInputElement>(null), reader = useRef<AbortController | null>(null), requestId = useRef(0);
  const [mode, setMode] = useState<ImportMode>(initial), [text, setText] = useState('');
  const [candidate, setCandidate] = useState<TextCandidate | null>(null), [backup, setBackup] = useState<BackupEnvelope | null>(null);
  const [pdf, setPdf] = useState<PdfImportResult | null>(null), [docx, setDocx] = useState<Omit<DocxImportResult, 'images'> | null>(null);
  const [docxPhotos, setDocxPhotos] = useState<ImportedPhoto[]>([]), [photoIndex, setPhotoIndex] = useState(0), [usePhoto, setUsePhoto] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const [locale, setLocale] = useState<Locale>('zh-CN'), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [committing, setCommitting] = useState(false), [progress, setProgress] = useState(''), [fileName, setFileName] = useState('');
  const [location, setLocation] = useState<StorageLocation>('local');
  useEffect(() => { if (open) setLocation('local'); }, [open]);
  const photo = mode === 'pdf' ? pdf?.photo : mode === 'docx' ? docxPhotos[photoIndex] : null;
  const photoUrl = useObjectUrl(photo?.blob);
  const originalPreview = useMemo(() => pdf ? { bytes: pdf.bytes, pages: pdf.candidate.pageCount, key: 'import-' + fileName + '-' + previewRetry } : null, [pdf, fileName, previewRetry]);

  useEffect(() => {
    if (!open) { requestId.current++; reader.current?.abort(); reader.current = null; setBusy(false); }
  }, [open]);
  useEffect(() => () => { reader.current?.abort(); }, []);
  const clearResult = () => { setCandidate(null); setBackup(null); setPdf(null); setDocx(null); setDocxPhotos([]); setPhotoIndex(0); setShowOriginal(false); };
  const switchMode = (value: ImportMode) => {
    requestId.current++; reader.current?.abort(); setMode(value); clearResult(); setFileName(''); setError(''); setBusy(false);
  };

  const readFile = async (file: File) => {
    reader.current?.abort(); const id = ++requestId.current, controller = new AbortController(); reader.current = controller;
    setError(''); setBusy(true); setFileName(file.name); clearResult(); setProgress('正在读取文件');
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        setMode('pdf');
        const result = await readPdfResume(file, { signal: controller.signal, onProgress: (page, total) => { if (id === requestId.current) setProgress('正在读取第 ' + page + ' / ' + total + ' 页'); } });
        if (id !== requestId.current) return;
        setPdf(result); setCandidate(result.candidate); setUsePhoto(Boolean(result.photo));
      } else if (/\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        setMode('docx'); setProgress('正在读取 Word 内容');
        const { readDocxResume } = await import('./docxImport');
        const result = await readDocxResume(file, { signal: controller.signal });
        const photos: ImportedPhoto[] = [];
        for (const image of result.images) {
          if (id !== requestId.current) return;
          try { photos.push(await normalizePhoto(new File([bytesBlob(image.data, image.mime)], 'word-photo', { type: image.mime }))); }
          catch { if (!result.warnings.includes('有图片无法用作头像，其说明文字已保留。')) result.warnings.push('有图片无法用作头像，其说明文字已保留。'); }
        }
        if (id !== requestId.current) return;
        setDocx({ candidate: result.candidate, sourceText: result.sourceText, warnings: result.warnings });
        setCandidate(result.candidate); setDocxPhotos(photos); setUsePhoto(Boolean(photos.length));
      } else if (/\.json$/i.test(file.name)) {
        setMode('backup');
        if (file.size > 20 * 1024 * 1024) throw new Error('备份文件需要小于 20 MB');
        const content = await file.text(); if (id === requestId.current) setBackup(parseBackup(content));
      } else if (/\.(?:txt|md|markdown)$/i.test(file.name)) {
        setMode('text');
        if (file.size > 1024 * 1024) throw new Error('文本文件需要小于 1 MB');
        const content = await file.text(); if (id !== requestId.current) return;
        setText(content); setCandidate(parseText(content, file.name.replace(/\.[^.]+$/, '').slice(0, 200)));
      } else throw new Error(/\.doc$/i.test(file.name) ? '请在 Word 中将 DOC 文件另存为 DOCX 后导入' : '请选择 PDF、DOCX、TXT、Markdown 或 SparkShark JSON 文件');
    } catch (error) {
      if (!controller.signal.aborted && id === requestId.current) setError(error instanceof Error ? error.message : '文件无法识别');
    } finally { if (id === requestId.current) { setBusy(false); setProgress(''); } }
  };

  const commit = async () => {
    const owner = accountScope().userId;
    setError(''); setCommitting(true);
    try {
      let resumes;
      if (mode === 'backup' && backup) {
        for (const asset of backup.assets) {
          const image = await imageFromBlob(bytesBlob(base64ToBytes(asset.dataBase64), asset.mime));
          if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw new Error('照片尺寸与备份记录不一致');
        }
        resumes = await repository.importBackup(backup);
      } else if (candidate) {
        const resume = resumeFromText(candidate, locale), assets: BackupEnvelope['assets'] = [];
        if (photo && usePhoto) {
          const data = new Uint8Array(await photo.blob.arrayBuffer()), id = uid('asset');
          resume.basics.avatarAssetId = id; resume.appearance.avatar.visible = true; resume.appearance.avatar.crop = null;
          resume.appearance.avatar.aspectRatio = Math.min(2.5, Math.max(.4, photo.width / photo.height));
          assets.push({ id, mime: photo.blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', width: photo.width, height: photo.height, sha256: await sha256(data), dataBase64: bytesToBase64(data) });
        }
        resumes = mode === 'pdf' || mode === 'docx'
          ? await repository.importBackup({ format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(), resumes: [resume], assets }, mode === 'docx' ? '导入 Word' : '导入 PDF')
          : [await repository.create(resume)];
      } else throw new Error('请先预览需要导入的内容');
      const result = await saveChosenResumes(resumes, location, owner);
      await useApp.getState().refresh(); useApp.getState().notify({ message: result.failed ? '已导入本机 ' + resumes.length + ' 份，其中云端成功 ' + result.uploaded + ' 份、未成功 ' + result.failed + ' 份；本机草稿已保留，可在云端简历页重试。' : '已导入 ' + resumes.length + ' 份简历' + (location === 'cloud' ? '并保存到云端' : '到本机'), error: Boolean(result.failed) });
      onClose(); if (resumes.length === 1) navigate('/resume/' + resumes[0].id);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setCommitting(false); }
  };
  const valid = mode === 'backup' ? Boolean(backup?.resumes.length) : Boolean(candidate);

  return <Modal open={open} onClose={() => { if (!committing) { reader.current?.abort(); onClose(); } }} title="导入简历" description="在当前浏览器读取文件，核对内容后创建可编辑的新简历。" wide disableClose={committing}>
    <div className="modal-body">
      <div className="segmented import-modes">{modes.map(([value, label]) => <button type="button" key={value} className={mode === value ? 'active' : ''} onClick={() => switchMode(value)} disabled={committing}>{value === 'backup' ? <FileJson size={15} /> : <FileText size={15} />}{label}</button>)}</div>
      <input type="file" className="sr-only" ref={input} aria-label="选择导入文件" accept=".pdf,.docx,.json,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ''; }} />
      <button type="button" className="import-drop" onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} disabled={committing} onDrop={event => { event.preventDefault(); if (!committing && event.dataTransfer.files[0]) void readFile(event.dataTransfer.files[0]); }}>
        {busy ? <LoaderCircle size={25} className="spin" /> : <Upload size={25} />}<strong>{busy ? progress : fileName || '选择文件，或拖到这里'}</strong><span>{formats[mode]}</span>
      </button>
      {mode !== 'backup' && <Field label="简历语言" htmlFor="import-locale"><select id="import-locale" value={locale} onChange={event => setLocale(event.target.value as Locale)}>{LOCALES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>}
      {mode === 'text' && <>
        <Field label="粘贴文本" htmlFor="import-text"><textarea id="import-text" value={text} onChange={event => { setText(event.target.value); setCandidate(null); }} placeholder={'# 个人总结\n\n你的简历内容……\n\n# 教育背景\n\n学校、专业和经历'} rows={7} /></Field>
        <div className="import-preview-actions"><Button secondary disabled={!text.trim() || busy} onClick={() => { try { setCandidate(parseText(text, fileName.replace(/\.[^.]+$/, '') || '导入的简历')); setError(''); } catch (error) { setCandidate(null); setError(error instanceof Error ? error.message : String(error)); } }}>预览解析结果</Button></div>
      </>}
      {mode === 'pdf' && pdf && <div className="pdf-import-result">
        <div className="pdf-import-summary"><strong>已读取 {pdf.candidate.pageCount} 页</strong><span>{candidate?.groups.length ?? 0} 个模块 · {pdf.candidate.columns === 2 ? '分栏内容' : '单栏内容'}</span></div>
        {pdf.candidate.warnings.map((warning, index) => <p className="pdf-import-warning" key={index}>{warning.message}</p>)}
        <Button secondary onClick={() => setShowOriginal(value => !value)}><Eye size={15} />{showOriginal ? '收起原 PDF' : '查看原 PDF'}</Button>
        {showOriginal && originalPreview && <div className="import-original-preview"><PdfPreview title="原 PDF 预览" result={originalPreview} pending={false} error={null} onRetry={() => setPreviewRetry(value => value + 1)} /></div>}
        <details className="pdf-extracted-text"><summary>查看完整提取文字</summary><textarea readOnly value={pdf.candidate.sourceText} aria-label="PDF 提取原文" rows={8} /></details>
        <p className="helper-text">PDF 内容会转为可编辑字段，排版可在导入后重新选择模板。请先核对姓名、联系方式和经历条目。</p>
      </div>}
      {mode === 'docx' && docx && <div className="pdf-import-result">
        <div className="pdf-import-summary"><strong>已读取 Word 内容</strong><span>{candidate?.groups.length ?? 0} 个模块 · {docxPhotos.length} 张可选头像</span></div>
        {docx.warnings.map((warning, index) => <p className="pdf-import-warning" key={index}>{warning}</p>)}
        <details className="pdf-extracted-text"><summary>查看完整提取文字</summary><textarea readOnly value={docx.sourceText} aria-label="Word 提取原文" rows={8} /></details>
        <p className="helper-text">标题、列表、链接和常用文字格式会保留。请核对经历条目，导入后可重新选择模板；正文图片以说明文字保留。</p>
      </div>}
      {photoUrl && <div className="pdf-import-photo"><img src={photoUrl} alt={mode === 'docx' ? 'Word 中可选的头像' : 'PDF 中识别的照片'} />
        {mode === 'docx' && docxPhotos.length > 1 ? <select aria-label="选择 Word 头像" value={photoIndex} onChange={event => setPhotoIndex(Number(event.target.value))}>{docxPhotos.map((_, index) => <option key={index} value={index}>图片 {index + 1}</option>)}</select> : <span>{mode === 'docx' ? '使用这张图片作为头像' : '使用识别到的照片'}</span>}
        <Toggle label={mode === 'docx' ? '使用 Word 中的图片作为头像' : '使用 PDF 中识别的照片'} checked={usePhoto} onChange={setUsePhoto} />
      </div>}
      {mode === 'backup' && backup && <div className="import-summary"><h3>将创建 {backup.resumes.length} 份简历</h3>{backup.resumes.map(resume => <div key={resume.id}><FileJson size={16} /><span>{resume.title || '未命名简历'}</span><small>{resume.sections.length} 个模块</small></div>)}<p>{backup.assets.length} 张照片{backup.histories ? ' · ' + backup.histories.length + ' 个历史版本' : ''}。现有简历保持原样。</p></div>}
      {mode !== 'backup' && candidate && <CandidateReview candidate={candidate} onChange={setCandidate} recognised={mode === 'pdf' || mode === 'docx'} preserveFormatting={mode === 'docx'} />}
      <StorageChoice value={location} onChange={setLocation} disabled={committing} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button secondary disabled={committing} onClick={() => { reader.current?.abort(); onClose(); }}>取消</Button><Button loading={committing} disabled={!valid || busy} onClick={() => void commit()}>确认导入</Button></div>
    </div>
  </Modal>;
}
