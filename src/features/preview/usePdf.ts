import { useEffect, useState } from 'react';
import type { Asset, RenderResult, Resume } from '../../domain/types';
import { snapshotOf } from '../../domain/resume';
import { renderPdf } from '../../rendering/client';
import { importMarkerFields } from '../../rendering/importMarkers';

export function usePdf(resume: Resume | null, assets: Record<string, Asset>, retry = 0) {
  const [state, setState] = useState<{ result: RenderResult | null; pending: boolean; error: string | null }>({ result: null, pending: Boolean(resume), error: null });
  const key = resume ? JSON.stringify(snapshotOf(resume)) : '';
  useEffect(() => {
    if (!resume) return;
    const controller = new AbortController();
    setState(previous => ({ ...previous, pending: true, error: null }));
    const timer = setTimeout(() => {
      renderPdf(structuredClone(resume), assets, controller.signal).then(result => { if (!controller.signal.aborted) setState({ result, pending: false, error: null }); }).catch(error => { if (!controller.signal.aborted) setState(previous => ({ ...previous, pending: false, error: error instanceof Error ? error.message : String(error) })); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, assets, retry]);
  return { ...state, warnings: resume ? importMarkerFields(resume) : [] };
}
