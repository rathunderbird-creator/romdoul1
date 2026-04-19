-- Activity Logs Table
-- Tracks user activities across the POS system

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action TEXT NOT NULL,          -- e.g., 'order_created', 'order_shipped', 'stock_in', 'stock_out'
    description TEXT NOT NULL,     -- Human-readable description
    user_id TEXT,                  -- Who performed the action
    user_name TEXT,                -- Display name of user
    metadata JSONB DEFAULT '{}',   -- Extra data (order ID, product name, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);

-- RLS Policies
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to activity_logs" ON activity_logs
    FOR ALL USING (true) WITH CHECK (true);

-- Run this in your Supabase SQL Editor to create the table
