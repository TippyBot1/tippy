-- Commands typed to the bot (/orders, /pause, /resume), waiting for Tippy's
-- next heartbeat from the user's computer. Picked up rows are deleted; rows
-- nobody picks up within 30 minutes are dropped with a note to the chat.
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  cmd TEXT NOT NULL,
  coin TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX inbox_link ON inbox (link_id, id);
CREATE INDEX inbox_age ON inbox (created_at);

-- 1 once this link's Tippy has said (in a heartbeat) that it carries out commands.
-- Older versions don't, so the bot tells those users to update instead of queueing.
ALTER TABLE links ADD COLUMN remote INTEGER NOT NULL DEFAULT 0;
