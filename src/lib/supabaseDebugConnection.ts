/**
 * /api/debug/* 에서만 사용 — 키 값은 노출하지 않고 호스트·프로젝트 ref만.
 * SQL Editor에서 데이터 넣은 Supabase와 NEXT_PUBLIC_SUPABASE_URL 이 같은지 대조용.
 */
export function getSupabaseConnectionDebugInfo(): {
  nextPublicSupabaseUrlHost: string;
  projectRefFromUrl: string;
  restV1CategorySortOrderListUrl: string;
  serverUsesServiceRoleKey: boolean;
  serverUsesAnonKeyFallback: boolean;
  rlsAndEmptyRowsHint: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let nextPublicSupabaseUrlHost = "";
  let projectRefFromUrl = "";
  let restV1CategorySortOrderListUrl = "";
  try {
    const u = new URL(url);
    nextPublicSupabaseUrlHost = u.host;
    projectRefFromUrl = u.hostname.split(".")[0] ?? "";
    restV1CategorySortOrderListUrl = `${u.origin}/rest/v1/category_sort_order?select=category,position&order=position.asc`;
  } catch {
    nextPublicSupabaseUrlHost = "(NEXT_PUBLIC_SUPABASE_URL 파싱 실패)";
  }

  const serverUsesServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const serverUsesAnonKeyFallback = !serverUsesServiceRoleKey;

  const rlsAndEmptyRowsHint = serverUsesServiceRoleKey
    ? "서버 클라이언트는 SUPABASE_SERVICE_ROLE_KEY로 연결되어 RLS를 우회합니다. 행이 0이면 테이블이 비었거나 URL이 다른 프로젝트를 가리키는 경우를 의심하세요."
    : "SUPABASE_SERVICE_ROLE_KEY가 없어 anon 키로 서버가 조회합니다. category_sort_order에 RLS가 켜져 있고 SELECT가 막히면 PostgREST는 에러 없이 빈 배열 []를 줄 수 있습니다. Dashboard → Table Editor / Authentication → Policies 확인.";

  return {
    nextPublicSupabaseUrlHost,
    projectRefFromUrl,
    restV1CategorySortOrderListUrl,
    serverUsesServiceRoleKey,
    serverUsesAnonKeyFallback,
    rlsAndEmptyRowsHint,
  };
}
