-- Run once against the existing D1 database. Existing records are preserved.
ALTER TABLE posts ADD COLUMN quote_name TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN quote_handle TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN quote_content TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN quote_posted_at TEXT;
