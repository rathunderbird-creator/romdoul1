-- New Chart of Accounts revenue account for the "PdFee" (Paid for Delivery
-- Fee) order status: a cancelled order where the customer still paid for
-- delivery. Kept separate from product-sale revenue (4000-4004) so it's
-- visible on its own in reports. Run this in each instance's Supabase SQL
-- editor.
INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active)
SELECT '4005', 'Delivery Fee Revenue', 'Revenue', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '4005');
