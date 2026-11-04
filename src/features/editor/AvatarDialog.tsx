import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import type { Appearance, Resume } from '../../domain/types';
import { useApp } from '../../app/store';
import { imageFromBlob, normalizePhoto } from '../../persistence/media';
import { Button, Field, Modal, Toggle, useObjectUrl } from '../../components/ui';
import { removeAvatar } from '../../domain/resume';
import { avatarCropAtZoom, avatarCropStyle, avatarCropZoom, avatarFrame } from '../../domain/avatar';
import './avatar.css';

type Crop = NonNullable<Appearance['avatar']['crop']>;
export function AvatarDialog({ open, onClose, resume }: { open: boolean; onClose: () => void; resume: Resume }) {
  const assets = useApp(state => state.assets), input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLDivElement>(null), [previewWidth, setPreviewWidth] = useState(240);
  const [blob, setBlob] = useState<Blob | undefined>(), [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [aspect, setAspect] = useState(.75), [zoom, setZoom] = useState(1), [crop, setCrop] = useState<Crop>({ x: 0, y: 0, width: 1, height: 1 });
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const url = useObjectUrl(blob);
  useEffect(() => {
    if (!open) return;
    const frame = avatarFrame(resume.appearance.avatar);
    setError(''); setZoom(1); setAspect(frame.aspectRatio);
    const asset = resume.basics.avatarAssetId ? assets[resume.basics.avatarAssetId] : undefined;
    setBlob(asset?.blob);
    if (asset) { const size = { width: asset.width, height: asset.height }; const current = frame.crop ?? avatarCropAtZoom(size, frame.aspectRatio); setDimensions(size); setCrop(current); setZoom(avatarCropZoom(size, frame.aspectRatio, current)); }
  }, [open]);
  useEffect(() => { const element = preview.current; if (!open || !element) return; const observer = new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width > 0) setPreviewWidth(width); }); observer.observe(element); return () => observer.disconnect(); }, [open, url]);
  const changeCrop = (nextAspect: number, nextZoom: number) => { setAspect(nextAspect); setZoom(nextZoom); setCrop(current => avatarCropAtZoom(dimensions, nextAspect, nextZoom, current)); };
  const cropStyle = avatarCropStyle(dimensions, crop, previewWidth, aspect);
  return <Modal open={open} onClose={onClose} disableClose={loading} title="头像设置" description="照片在当前浏览器处理和保存。支持 JPG、PNG、WebP，最大 5 MB。"><div className="modal-body"><input type="file" accept="image/png,image/jpeg,image/webp" ref={input} className="sr-only" aria-label="选择头像文件" onChange={async event => {
    const file = event.target.files?.[0]; if (!file) return; setLoading(true); setError('');
    try { const photo = await normalizePhoto(file); const size = { width: photo.width, height: photo.height }; setBlob(photo.blob); setDimensions(size); setZoom(1); setCrop(avatarCropAtZoom(size, aspect)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); event.target.value = ''; }
  }} />
    <div className="crop-preview-wrap">{url ? <div ref={preview} className="crop-preview" style={{ width: 240, height: 'auto', aspectRatio: aspect }} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const x = event.clientX, y = event.clientY, original = crop; const element = event.currentTarget; const displayed = avatarCropStyle(dimensions, original, element.clientWidth, aspect); const move = (move: PointerEvent) => setCrop({ ...original, x: Math.max(0, Math.min(1 - original.width, original.x - (move.clientX - x) / displayed.width)), y: Math.max(0, Math.min(1 - original.height, original.y - (move.clientY - y) / displayed.height)) }); const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); }; element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); }}><img src={url} alt="头像裁剪预览" draggable={false} style={{ position: 'absolute', ...cropStyle, maxWidth: 'none' }} /></div> : <div className="crop-empty"><ImagePlus size={36} /><span>选择一张照片</span></div>}</div>
    <Button secondary className="full-width" onClick={() => input.current?.click()} disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}选择照片</Button>
    {blob && <div className="form-grid crop-settings"><Field label="照片比例" htmlFor="photo-aspect"><select id="photo-aspect" value={aspect} onChange={event => changeCrop(Number(event.target.value), zoom)}>{![1, .75, 4 / 3].includes(aspect) && <option value={aspect}>当前长方形比例</option>}<option value={.75}>3 : 4 · 证件照长方形</option><option value={4 / 3}>4 : 3 · 横向长方形</option><option value={1}>1 : 1 · 直角方形</option></select></Field><Field label="缩放" htmlFor="photo-zoom"><input id="photo-zoom" type="range" min={1} max={Math.max(3, zoom)} step={.05} value={zoom} onChange={event => changeCrop(aspect, Number(event.target.value))} /></Field><Field label="水平位置" htmlFor="crop-x"><input id="crop-x" type="range" min={0} max={Math.max(0, 1 - crop.width)} step={.001} value={crop.x} onChange={event => setCrop({ ...crop, x: Number(event.target.value) })} /></Field><Field label="垂直位置" htmlFor="crop-y"><input id="crop-y" type="range" min={0} max={Math.max(0, 1 - crop.height)} step={.001} value={crop.y} onChange={event => setCrop({ ...crop, y: Number(event.target.value) })} /></Field></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="setting-row"><span>在简历中显示头像</span><Toggle label="显示头像" checked={resume.appearance.avatar.visible} onChange={visible => useApp.getState().update(next => { next.appearance.avatar.visible = visible; })} /></div>
    <div className="modal-actions">{resume.basics.avatarAssetId && <Button secondary className="danger" disabled={loading} onClick={async () => {
      setLoading(true); setError('');
      try {
        if (!(await useApp.getState().tracked('删除头像前', removeAvatar))) return;
        const saved = await useApp.getState().flush();
        setBlob(undefined); useApp.getState().notify({ message: saved ? '头像已删除，可从历史记录恢复' : '头像已移除，当前修改尚未保存', error: !saved }); onClose();
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { setLoading(false); }
    }}><Trash2 size={15} />删除头像</Button>}<Button secondary disabled={loading} onClick={onClose}>取消</Button><Button loading={loading} disabled={!blob} onClick={async () => {
      if (!blob) return; setLoading(true); setError('');
      try { const image = await imageFromBlob(blob); const asset = await useApp.getState().putAsset(blob, image.naturalWidth, image.naturalHeight);
        const apply = (next: Resume) => { next.basics.avatarAssetId = asset.id; next.appearance.avatar = { ...avatarFrame(next.appearance.avatar), crop, aspectRatio: aspect, radiusPx: 0, visible: true }; };
        if (resume.basics.avatarAssetId) { if (!(await useApp.getState().tracked('调整照片', apply))) return; } else useApp.getState().update(apply);
        const saved = await useApp.getState().flush(); useApp.getState().notify({ message: saved ? '照片已保存' : '照片已更新，当前修改尚未保存', error: !saved }); onClose();
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); }
    }}>保存照片</Button></div>
  </div></Modal>;
}
