-- Add new size-analysis structure enum for multi-item personal order rows.
ALTER TYPE "SizeAnalysisStructureType" ADD VALUE IF NOT EXISTS 'multi_item_personal_order';
