import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type EditorMode = 'content' | 'layout' | 'templates' | 'appearance' | 'export';
const Navigation = createContext<{ mode: EditorMode; setMode: (mode: EditorMode) => void; drawer: boolean; setDrawer: (open: boolean) => void }>({ mode: 'content', setMode: () => undefined, drawer: false, setDrawer: () => undefined });
export function NavigationProvider({ children }: { children: ReactNode }) { const [mode, setMode] = useState<EditorMode>('content'), [drawer, setDrawer] = useState(false); return <Navigation.Provider value={{ mode, setMode, drawer, setDrawer }}>{children}</Navigation.Provider>; }
export const useNavigation = () => useContext(Navigation);
