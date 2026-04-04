-- Run in Supabase SQL Editor
-- CSV에서 카테고리가 처음 나온 순서를 저장해 상품 목록 정렬에 사용합니다.

CREATE TABLE IF NOT EXISTS category_sort_order (
  category text NOT NULL PRIMARY KEY,
  position integer NOT NULL
);

CREATE INDEX IF NOT EXISTS category_sort_order_position_idx ON category_sort_order (position);
