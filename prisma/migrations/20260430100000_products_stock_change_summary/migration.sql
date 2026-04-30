-- 재고 현황: 수량변경일 행 내 최근 증감 표시용(예: `[남95: +2, 여90: -1]`)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_change_summary" TEXT;
