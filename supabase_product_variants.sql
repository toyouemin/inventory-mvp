-- (레거시) product_id+size 유니크 예시. 신규는 supabase_product_variants_unique_sku_color_gender_size.sql 참고.
-- Run this in Supabase SQL Editor to add size-based inventory support.
-- Creates product_variants table (and optionally create product-images bucket in Storage for image uploads).

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0,
  memo text NULL,
  color text NULL,
  gender text NULL,
  option_tag text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS memo text NULL;

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS color text NULL;

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS gender text NULL;

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS option_tag text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_size_key
  ON product_variants (product_id, size);

COMMENT ON TABLE product_variants IS 'Per-size stock for products (size column can be S/M/L or empty for single-SKU)';

-- Optional: For product image upload, create a Storage bucket in Supabase Dashboard:
-- Storage -> New bucket -> Name: product-images -> Public bucket: ON
