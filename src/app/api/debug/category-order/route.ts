import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseClient";
import { probeCategorySortOrderAccess } from "@/lib/supabaseCategorySortOrderProbe";
import { getSupabaseConnectionDebugInfo } from "@/lib/supabaseDebugConnection";
import { normalizeCategoryLabel } from "@/app/products/categoryNormalize";
import { fetchCategoryOrderMap } from "@/app/products/categorySortOrder.server";
import {
  MERGE_PATH_DESCRIPTIONS,
  diagnoseCategoryOrderPipeline,
} from "@/app/products/categorySortOrder.utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/debug/category-order
 * - 서버 로그: public.category_sort_order RAW (fetchCategoryOrderMap 전/후)
 * - 응답: Supabase 연결 정보(호스트·service vs anon)로 SQL Editor 프로젝트와 대조
 */
export async function GET() {
  if (!supabaseServer) {
    return NextResponse.json({ ok: false, error: "Supabase server client not ready" }, { status: 500 });
  }

  const supabaseConnection = getSupabaseConnectionDebugInfo();
  console.info("[api/debug/category-order] Supabase 연결(키 미포함)", supabaseConnection);

  const coSel = () =>
    supabaseServer
      .from("category_sort_order")
      .select("category, position")
      .order("position", { ascending: true });
  /** supabase-js + order 조합이 이 라우트의 초기 요청에서만 [] 를 주는 경우가 있어, REST 프로브 후에 pre 를 읽는다. */
  const restProbe = await probeCategorySortOrderAccess();
  const preCo = await coSel();
  console.info("[api/debug/category-order] REST/HEAD 프로브(키 미포함 필드만)", {
    supabaseJsHeadCount: restProbe.supabaseJsHeadCount,
    supabaseJsHeadError: restProbe.supabaseJsHeadError,
    rawRestStatus: restProbe.rawRestStatus,
    rawRestRowCount: restProbe.rawRestRowCount,
    restV1ListUrlHost: (() => {
      try {
        return new URL(restProbe.restV1ListUrl).host;
      } catch {
        return "";
      }
    })(),
  });

  console.info(
    "[api/debug/category-order] public.category_sort_order RAW (fetchCategoryOrderMap 이전)",
    JSON.stringify(
      {
        error: preCo.error,
        code: preCo.error?.code ?? null,
        message: preCo.error?.message ?? null,
        rowCount: preCo.data?.length ?? 0,
        rows: preCo.data ?? [],
      },
      null,
      2
    )
  );

  const { data: prodData, error: prodErr } = await supabaseServer
    .from("products")
    .select("id, sku, category, created_at")
    .order("sku", { ascending: true });

  if (prodErr) {
    return NextResponse.json({ ok: false, error: prodErr.message, supabaseConnection }, { status: 500 });
  }

  const products = (prodData ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    sku: String(r.sku ?? ""),
    category: normalizeCategoryLabel(r.category as string | null) || null,
    createdAt: (r.created_at as string) ?? null,
  }));

  const categoryOrderFromFetch = await fetchCategoryOrderMap();

  const postCo = await supabaseServer
    .from("category_sort_order")
    .select("category, position")
    .order("position", { ascending: true });
  console.info(
    "[api/debug/category-order] public.category_sort_order RAW (fetchCategoryOrderMap 이후)",
    JSON.stringify(
      {
        error: postCo.error,
        code: postCo.error?.code ?? null,
        message: postCo.error?.message ?? null,
        rowCount: postCo.data?.length ?? 0,
        rows: postCo.data ?? [],
      },
      null,
      2
    )
  );

  if (postCo.error) {
    return NextResponse.json(
      {
        ok: false,
        error: postCo.error.message,
        supabaseConnection,
        categorySortOrderSelectError: postCo.error,
      },
      { status: 500 }
    );
  }

  const coRows = postCo.data;
  const dbMapRaw: Record<string, number> = {};
  for (const r of (coRows ?? []) as { category: string; position: number }[]) {
    dbMapRaw[r.category] = Number(r.position);
  }

  const diagnosis = diagnoseCategoryOrderPipeline(products, dbMapRaw);
  const mergePathMeaning =
    MERGE_PATH_DESCRIPTIONS[diagnosis.mergePath] ?? "(알 수 없는 mergePath)";

  const productCount = products.length;
  const postRowCount = coRows?.length ?? 0;
  const preRowCount = preCo.data?.length ?? 0;
  const emptyDiagnostics = {
    categorySortOrderRowsAfterFetch: postRowCount,
    productsRowCount: productCount,
    likelyCausesIfStillEmpty:
      postRowCount === 0
        ? [
            "SQL을 넣은 Supabase 프로젝트와 .env.local 의 NEXT_PUBLIC_SUPABASE_URL 호스트가 다른 경우",
            "SUPABASE_SERVICE_ROLE_KEY 없이 anon만 쓰는데 category_sort_order 에 RLS로 SELECT가 막힌 경우(에러 없이 [] 가능)",
            "실제로 public.category_sort_order 에 행이 없는 경우",
            "스키마/이름 오타 — 앱은 public.category_sort_order 만 조회",
            "PostgREST 스키마 캐시: SQL Editor에서 테이블을 만든 직후 REST가 아직 모를 수 있음 — SQL에서 NOTIFY pgrst, 'reload schema'; 실행 또는 Dashboard → Settings → API → Reload schema",
            "categorySortOrderRestProbe: rawRestRowCount 가 0이 아닌데 rowCount만 0이면 앱 버그 가능성 — 반대로 rawRestRowCount 도 0이면 동일 프로젝트의 REST 관점에서 테이블이 비어 있음",
          ]
        : [],
    restProbeMismatch:
      postRowCount === 0 &&
      restProbe.rawRestRowCount != null &&
      restProbe.rawRestRowCount > 0
        ? "원시 GET은 행이 있는데 supabase-js select는 비었습니다. 버전/필터/클라이언트 설정을 의심하세요."
        : null,
  };

  if (postRowCount === 0 && productCount > 0) {
    console.warn(
      "[api/debug/category-order] 상품은 있으나 category_sort_order 행이 0입니다.",
      emptyDiagnostics
    );
  }

  return NextResponse.json(
    {
      ok: true,
      now: new Date().toISOString(),
      supabaseConnection,
      categorySortOrderRestProbe: {
        restV1ListUrl: restProbe.restV1ListUrl,
        supabaseJsHeadCount: restProbe.supabaseJsHeadCount,
        supabaseJsHeadError: restProbe.supabaseJsHeadError,
        rawRestStatus: restProbe.rawRestStatus,
        rawRestRowCount: restProbe.rawRestRowCount,
        rawRestNotJsonSnippet: restProbe.rawRestNotJsonSnippet,
      },
      mergePathLegend: MERGE_PATH_DESCRIPTIONS,
      categorySortOrderPreFetch: {
        error: preCo.error,
        rowCount: preRowCount,
        rows: preCo.data ?? [],
      },
      categorySortOrderPostFetch: {
        error: postCo.error,
        rowCount: postRowCount,
        rows: coRows ?? [],
      },
      categorySortOrderTableRows: coRows,
      dbMapRaw,
      categoryOrderFromFetch,
      diagnosis,
      mergePathMeaning,
      emptyDiagnostics,
      compareProjectHint:
        "Supabase Dashboard URL의 프로젝트 ref와 supabaseConnection.projectRefFromUrl 가 같아야 SQL Editor에서 넣은 데이터와 앱이 읽는 DB가 일치합니다.",
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}
