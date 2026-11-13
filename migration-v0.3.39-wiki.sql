-- PIA v0.3.39: isolated private group wiki. Run ONCE against the existing D1 DB.
-- Existing X accounts/posts/settings tables are NOT modified.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS wiki_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wiki_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES wiki_folders(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES wiki_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS wiki_folders_parent ON wiki_folders(parent_id,position);

CREATE TABLE IF NOT EXISTS wiki_docs (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES wiki_folders(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft',
  source_url TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  blocks_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES wiki_members(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES wiki_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS wiki_docs_folder ON wiki_docs(folder_id,deleted_at,updated_at);
CREATE INDEX IF NOT EXISTS wiki_docs_updated ON wiki_docs(deleted_at,updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_assets (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES wiki_docs(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT REFERENCES wiki_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS wiki_assets_doc ON wiki_assets(doc_id);
