ALTER TABLE posts ADD COLUMN quote_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_quote_target ON posts(quote_post_id);
