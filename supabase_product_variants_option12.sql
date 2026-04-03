-- Supabase SQL Editor: variant 길이(option1)·성별(option2)·순수 사이즈(size) 분리 저장
-- 기존 행은 option1/option2가 '' 이고 size에 결합 문자열이 그대로 있을 수 있음(앱에서 표시 시 파싱).

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS option1 text NOT NULL DEFAULT '';

ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS option2 text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS product_variants_product_size_key;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_opts_size_key
  ON product_variants (product_id, option1, option2, size);

COMMENT ON COLUMN product_variants.option1 IS '길이 등 (예: 3부, 4부)';
COMMENT ON COLUMN product_variants.option2 IS '성별 (예: 남, 여, 공용)';
COMMENT ON COLUMN product_variants.size IS '순수 사이즈 (예: W28, 90)';
