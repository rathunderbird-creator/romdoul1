-- CLEANUP IMAGES FROM DATABASE
-- Run this script to free up space by removing existing images from sale_items.

-- 1. Set all images to NULL
UPDATE sale_items SET image = NULL;

-- 2. Verify that images are gone
SELECT count(*) as count_with_images FROM sale_items WHERE image IS NOT NULL;
