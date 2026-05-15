-- 엑셀 전용 Storage 썸네일 공개 URL (`product-images/thumbs/{stem}.jpg`)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "thumbnail_url" TEXT;
