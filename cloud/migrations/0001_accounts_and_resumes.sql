PRAGMA foreign_keys = ON;

CREATE TABLE app_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  registration_open INTEGER NOT NULL DEFAULT 1 CHECK (registration_open IN (0, 1)),
  default_resume_quota INTEGER NOT NULL DEFAULT 10 CHECK (default_resume_quota BETWEEN 0 AND 10000),
  bootstrap_completed INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_completed IN (0, 1))
);
INSERT INTO app_settings (singleton) VALUES (1);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  resume_quota INTEGER NOT NULL DEFAULT 10 CHECK (resume_quota BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE resumes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (length(CAST(data_json AS BLOB)) <= 524288),
  revision INTEGER NOT NULL CHECK (revision > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mutation_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX resumes_user_updated ON resumes(user_id, updated_at DESC);

CREATE TABLE resume_assets (
  user_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  PRIMARY KEY (user_id, resume_id, asset_id),
  FOREIGN KEY (user_id, resume_id) REFERENCES resumes(user_id, id) ON DELETE CASCADE
);

CREATE TABLE resume_asset_chunks (
  user_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  chunk_no INTEGER NOT NULL CHECK (chunk_no >= 0),
  data BLOB NOT NULL CHECK (length(data) BETWEEN 1 AND 524288),
  PRIMARY KEY (user_id, resume_id, asset_id, chunk_no),
  FOREIGN KEY (user_id, resume_id, asset_id)
    REFERENCES resume_assets(user_id, resume_id, asset_id) ON DELETE CASCADE
);

CREATE TABLE auth_rate_windows (
  key_hash TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, window_id)
);
CREATE INDEX auth_rate_expiry ON auth_rate_windows(expires_at);
