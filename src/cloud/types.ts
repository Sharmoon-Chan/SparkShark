import type { BackupAsset, Resume } from '../domain/types';

export interface CloudUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  resumeQuota: number;
  resumeCount: number;
  storageBytes: number;
  createdAt: string;
}

export interface CloudSettings {
  registrationOpen: boolean;
  defaultResumeQuota: number;
  maxResumeBytes: number;
  maxAssetBytes: number;
}

export interface CloudSession {
  user: CloudUser | null;
  csrfToken: string | null;
  settings: CloudSettings;
}

export interface CloudResumeSummary {
  id: string;
  title: string;
  updatedAt: string;
  revision: number;
  byteSize: number;
}

export interface CloudResumeDocument {
  resume: Resume;
  assets: BackupAsset[];
  revision: number;
  byteSize: number;
}

export interface CloudResumeWrite {
  resume: Resume;
  assets: BackupAsset[];
  expectedRevision?: number;
}

export interface CloudResumeList {
  resumes: CloudResumeSummary[];
  quota: number;
  used: number;
  storageBytes: number;
}

export interface CloudAdminOverview {
  totalUsers: number;
  activeUsers: number;
  totalResumes: number;
  totalStorageBytes: number;
}

export interface CloudAdminUsers {
  users: CloudUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CloudErrorBody {
  error: { code: string; message: string };
}
