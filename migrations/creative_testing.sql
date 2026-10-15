-- Creative Testing (Profit & CPA Tracker section) — run once per instance in
-- the Supabase SQL editor. Two manual-entry tables mirroring the
-- "Product CPA & Creative Testing Tracker" workbook:
--   creative_tests  = Testing Products & Sandbox (7-day creative AB tests)
--   winner_ads      = Winner Ads Tracker (graduated creatives being scaled)
-- Targets (target/break-even CPA) are NOT stored: the app derives them live
-- from the product catalogue + cpa_product_settings, like the CPA tracker.

CREATE TABLE IF NOT EXISTS creative_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_date DATE NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  product_id TEXT,
  product_name TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  ad_spend NUMERIC NOT NULL DEFAULT 0,
  inbound_chats INTEGER NOT NULL DEFAULT 0,
  closed_orders INTEGER NOT NULL DEFAULT 0,
  delivered_orders INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS winner_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graduated_date DATE,
  post_id TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  product_id TEXT,
  product_name TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  daily_budget NUMERIC NOT NULL DEFAULT 0,
  spend_7d NUMERIC NOT NULL DEFAULT 0,
  delivered_7d INTEGER NOT NULL DEFAULT 0,
  frequency NUMERIC,
  ctr NUMERIC,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
