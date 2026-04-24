-- AlterTable: 사이즈분석 정규화 행 제외 사유
ALTER TABLE "SizeAnalysisRow" ADD COLUMN IF NOT EXISTS "excludeReason" TEXT;
ALTER TABLE "SizeAnalysisRow" ADD COLUMN IF NOT EXISTS "excludeDetail" TEXT;
