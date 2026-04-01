-- Run in Supabase SQL Editor
-- Adds new columns to products table.

ALTER TABLE products
ADD COLUMN IF NOT EXISTS extra_price integer NULL;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS memo2 text NULL;
