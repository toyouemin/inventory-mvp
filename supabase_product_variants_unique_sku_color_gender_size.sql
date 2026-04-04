-- Supabase SQL Editor: product_variants 유니크를 (sku, color, gender, size) 로 통일
-- 앱은 insert/upsert 시 onConflict: sku,color,gender,size 를 사용합니다.
--
-- 이전 스키마에서 흔한 인덱스/제약 예시:
--   product_variants_product_size_key          (product_id, size)
--   product_variants_product_opts_size_key     (product_id, option1, option2, size)

DROP INDEX IF EXISTS product_variants_product_size_key;
DROP INDEX IF EXISTS product_variants_product_opts_size_key;

ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_product_size_key;

ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_product_opts_size_key;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sku text NOT NULL DEFAULT '';

UPDATE product_variants pv
SET sku = p.sku
FROM products p
WHERE pv.product_id = p.id
  AND (pv.sku = '' OR pv.sku IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_color_gender_size_key
  ON product_variants (sku, color, gender, size);

COMMENT ON INDEX product_variants_sku_color_gender_size_key IS '변형 유니크: sku + color + gender + size';
