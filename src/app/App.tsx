import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useApp } from './store';
import { NavigationProvider } from './navigation';
import { Sidebar } from './Sidebar';
import { Home, BackupPage } from '../features/resumes/Home';
import { Editor } from '../features/editor/Editor';
import { Toast } from '../components/ui';

export default function App() {
  const ready = useApp(state => state.ready), storageError = useApp(state => state.storageError);
  useEffect(() => { if (!ready) void useApp.getState().initialize(); }, [ready]);
  if (!ready) return <div className="app-loading"><LoaderCircle className="spin" size={24} />正在打开工作区</div>;
  return <BrowserRouter><NavigationProvider><div className="app-shell"><Sidebar /><Routes><Route path="/" element={<Home />} /><Route path="/trash" element={<Home trash />} /><Route path="/backup" element={<BackupPage />} /><Route path="/resume/:id" element={<Editor />} /><Route path="*" element={<Home />} /></Routes>{storageError && <div className="storage-banner" role="alert">当前浏览器暂时无法保存。内容仍可编辑，请下载 JSON 备份。</div>}<Toast /></div></NavigationProvider></BrowserRouter>;
}
