-- Add message_template column to telegram_notifications table
ALTER TABLE telegram_notifications ADD COLUMN IF NOT EXISTS message_template TEXT;
