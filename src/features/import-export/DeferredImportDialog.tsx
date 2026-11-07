import { deferredDialog } from '../../components/deferredDialog';

export const DeferredImportDialog = deferredDialog(() => import('./ImportDialog').then(module => module.ImportDialog), '导入简历');
