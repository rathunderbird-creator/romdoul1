-- Recurring tasks + reminder times for the Todo page.
--
-- repeat_rule       'daily' | 'weekly' | 'monthly', or NULL for a one-off task.
--                   When a repeating task is completed the app rolls due_date
--                   forward to the next occurrence instead of closing it.
-- remind_at         Local time-of-day to remind, stored as 'HH:MM' (24h). NULL = no reminder.
-- last_reminded_on  Local calendar date the reminder last fired, so a task
--                   reminds at most once per day even if the POS is reopened.

ALTER TABLE todos ADD COLUMN IF NOT EXISTS repeat_rule TEXT;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS remind_at TEXT;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS last_reminded_on DATE;

-- Guard against typos writing an unrecognised cadence.
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_repeat_rule_check;
ALTER TABLE todos ADD CONSTRAINT todos_repeat_rule_check
    CHECK (repeat_rule IS NULL OR repeat_rule IN ('daily', 'weekly', 'monthly'));
