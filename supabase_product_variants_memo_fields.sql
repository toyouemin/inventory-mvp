-- Run in Supabase SQL Editor
-- Adds variant-level memo fields for option-based notes.

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS memo text NULL;

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS memo2 text NULL;
