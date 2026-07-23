-- Create telegram_notifications table
CREATE TABLE IF NOT EXISTS telegram_notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name TEXT NOT NULL,
    bot_token TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    trigger_statuses TEXT[] DEFAULT '{}',
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
