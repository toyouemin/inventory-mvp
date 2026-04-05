-- Run in Supabase SQL Editor
-- CSV에서 카테고리가 처음 나온 순서를 저장해 상품 목록 정렬에 사용합니다.

CREATE TABLE IF NOT EXISTS category_sort_order (
  category text NOT NULL PRIMARY KEY,
  position integer NOT NULL
);

CREATE INDEX IF NOT EXISTS category_sort_order_position_idx ON category_sort_order (position);

-- RLS: 위 스크립트는 RLS를 켜지 않습니다. 이 테이블에 RLS를 켠 경우
-- SELECT 정책이 없으면 anon 키로는 행이 0건으로 보일 수 있습니다(PostgREST는 에러 없이 [] 반환 가능).
-- 서버 앱은 SUPABASE_SERVICE_ROLE_KEY 가 있으면 RLS를 우회합니다.
