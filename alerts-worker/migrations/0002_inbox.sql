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

-- The command set this link's Tippy said (in its heartbeat) it carries out:
-- 0 = none (older versions — the bot tells them to update), 1 = orders/pause/resume,
-- 2 = + cancel. See NEEDS in src/commands.ts.
ALTER TABLE links ADD COLUMN remote INTEGER NOT NULL DEFAULT 0;
