-- WAREHOUSE1, WAREHOUSE2 -> WAREHOUSE 병합
-- 1. WAREHOUSE 위치 추가
INSERT OR IGNORE INTO "Location" ("code", "name") VALUES ('WAREHOUSE', '창고');

-- 2. 각 상품별 WAREHOUSE 재고 생성 (WAREHOUSE1+WAREHOUSE2 합산)
INSERT INTO "StockBalance" ("productId", "locationId", "qty")
SELECT p.id, (SELECT id FROM "Location" WHERE "code" = 'WAREHOUSE' LIMIT 1),
  COALESCE((
    SELECT SUM(sb."qty") FROM "StockBalance" sb
    JOIN "Location" l ON sb."locationId" = l.id
    WHERE l."code" IN ('WAREHOUSE1', 'WAREHOUSE2') AND sb."productId" = p.id
  ), 0)
FROM "Product" p
WHERE NOT EXISTS (
  SELECT 1 FROM "StockBalance" sb
  JOIN "Location" l ON sb."locationId" = l.id
  WHERE l."code" = 'WAREHOUSE' AND sb."productId" = p.id
);

-- 3. WAREHOUSE1, WAREHOUSE2 재고 삭제
DELETE FROM "StockBalance"
WHERE "locationId" IN (SELECT id FROM "Location" WHERE "code" IN ('WAREHOUSE1', 'WAREHOUSE2'));

-- 4. WAREHOUSE1, WAREHOUSE2 위치 삭제
DELETE FROM "Location" WHERE "code" IN ('WAREHOUSE1', 'WAREHOUSE2');
