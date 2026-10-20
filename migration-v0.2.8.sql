CREATE TABLE IF NOT EXISTS pia_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO pia_settings(key,value) VALUES ('anonymous','0');
