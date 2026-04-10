-- 재고 변경 전용 시각 컬럼
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS stock_updated_at timestamptz;

COMMENT ON COLUMN public.products.stock_updated_at IS
'상품 재고(stock)가 마지막으로 변경된 시각';

CREATE INDEX IF NOT EXISTS idx_products_stock_updated_at
ON public.products (stock_updated_at DESC);
