-- Supabase SQL Editor: 동일 SKU(대소문자·앞뒤 공백 무시)로 products가 여러 행인지 진단
-- 1) 정규화 SKU당 product id 개수·목록
WITH p AS (
  SELECT
    id,
    sku,
    upper(trim(regexp_replace(trim(sku), '\s+', ' ', 'g'))) AS norm_sku,
    name,
    category
  FROM products
  WHERE trim(coalesce(sku, '')) <> ''
)
SELECT
  norm_sku,
  count(*)::int AS product_row_count,
  array_agg(id::text ORDER BY id::text) AS product_ids,
  array_agg(name ORDER BY id::text) AS names
FROM p
GROUP BY norm_sku
HAVING count(*) > 1
ORDER BY norm_sku;

-- 2) 특정 norm_sku(예: T25KT1033BL) — product_id별 variant 수
WITH target AS (
  SELECT id, sku
  FROM products
  WHERE upper(trim(regexp_replace(trim(sku), '\s+', ' ', 'g'))) = 'T25KT1033BL'
)
SELECT
  p.id AS product_id,
  p.sku,
  count(pv.id)::int AS variant_count
FROM target p
LEFT JOIN product_variants pv ON pv.product_id = p.id
GROUP BY p.id, p.sku
ORDER BY p.id;

-- 3) 남 + 사이즈 100 (표기 차이 완화) variant가 어느 product_id에 붙는지
SELECT
  pv.id AS variant_id,
  pv.product_id,
  p.sku AS product_sku,
  pv.sku AS variant_row_sku,
  pv.color,
  pv.gender,
  pv.size,
  pv.stock
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE upper(trim(regexp_replace(trim(p.sku), '\s+', ' ', 'g'))) = 'T25KT1033BL'
  AND (
    trim(pv.gender) ILIKE '%남%'
    OR lower(trim(pv.gender)) = 'm'
  )
  AND trim(pv.size) IN ('100', '100 ');
