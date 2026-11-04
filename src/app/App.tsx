import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useApp } from './store';
import { NavigationProvider } from './navigation';
import { Sidebar } from './Sidebar';
import { Home, BackupPage } from '../features/resumes/Home';
import { Editor } from '../features/editor/Editor';
import { Button, Toast } from '../components/ui';
import { initializeAccount, refreshLinks, useCloud } from '../cloud/account';
import { installCloudSync } from '../cloud/sync';
import { AuthDialog } from '../cloud/AccountUI';
import { CloudPage } from '../cloud/CloudPage';
import { AdminPage } from '../cloud/AdminPage';
import '../cloud/cloud.css';

export default function App() {
  const ownershipReady = useCloud(state => state.ownershipReady);
  const accountReady = useCloud(state => state.ready);
  const ownershipError = useCloud(state => state.ownershipError);
  useEffect(() => { installCloudSync(); void initializeAccount(); }, []);
  const ready = useApp(state => state.ready), storageError = useApp(state => state.storageError);
  useEffect(() => { if (!ready) void useApp.getState().initialize(); }, [ready]);
  if (!ready || !ownershipReady || !accountReady) return <div className="app-loading"><LoaderCircle className="spin" size={24} />正在打开工作区</div>;
  return <BrowserRouter><NavigationProvider><div className="app-shell"><Sidebar /><Routes><Route path="/" element={<Home />} /><Route path="/trash" element={<Home trash />} /><Route path="/backup" element={<BackupPage />} /><Route path="/cloud" element={<CloudPage />} /><Route path="/admin" element={<AdminPage />} /><Route path="/resume/:id" element={<Editor />} /><Route path="*" element={<Home />} /></Routes>{storageError && <div className="storage-banner" role="alert">当前浏览器暂时无法保存。内容仍可编辑，请下载 JSON 备份。</div>}<Toast /><AuthDialog />{ownershipError && <div className="storage-banner" role="alert"><span>{ownershipError}</span><Button secondary onClick={() => void refreshLinks().catch(() => undefined)}>重试读取保存位置</Button></div>}</div></NavigationProvider></BrowserRouter>;
}
