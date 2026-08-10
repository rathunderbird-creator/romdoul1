-- Fixes Telegram configuration saving, which fails app-wide without this column.
--
-- `updateStoreProfile` in src/context/StoreContext.tsx upserts `message_template`
-- on every telegram config write, but the column was never added to this instance.
-- PostgREST rejects the whole upsert with:
--   "Could not find the 'message_template' column of 'telegram_notifications'"
-- so BOTH Settings → Telegram and the Todo reminder settings silently fail to save.
--
-- The column holds an optional custom message format for order notifications;
-- NULL means "use the default format".

ALTER TABLE telegram_notifications ADD COLUMN IF NOT EXISTS message_template TEXT;
