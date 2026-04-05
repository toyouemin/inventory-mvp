import { NextResponse } from "next/server";
import { rebuildCategorySortOrderFromDatabase } from "@/app/products/categorySortOrder.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/debug/rebuild-category-sort-order
 * CSV 없이 category_sort_order를 현재 테이블 position 순(정규형 키)으로 다시 쓰고,
 * products에만 있는 카테고리는 뒤에 가나다순(locale ko)으로 추가합니다. (created_at 미사용)
 */
export async function POST() {
  try {
    const { categories } = await rebuildCategorySortOrderFromDatabase();
    return NextResponse.json(
      {
        ok: true,
        now: new Date().toISOString(),
        message: "category_sort_order 재작성 완료",
        categories,
        count: categories.length,
      },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
