-- Carrier tracking cache: one row per tracking number, written by the app
-- after a lookup through /api/track-shipments (see src/hooks/useShipmentTracking.ts).
-- Safe to run any time; the app tolerates the table being missing (it just
-- can't remember statuses between page loads until this runs).
CREATE TABLE IF NOT EXISTS shipment_tracking (
    tracking_no TEXT PRIMARY KEY,
    carrier TEXT,
    last_status TEXT,
    last_event_at TEXT,           -- carrier's own timestamp string, shown as-is
    is_delivered BOOLEAN DEFAULT false,
    events JSONB DEFAULT '[]'::jsonb,
    error TEXT,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE shipment_tracking DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
