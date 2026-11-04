const listeners = new Set<(id: string) => void>();
export function onLocalResumeSaved(listener: (id: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function localResumeSaved(id: string) { for (const listener of listeners) listener(id); }
