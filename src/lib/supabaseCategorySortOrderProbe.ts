import { supabaseServer } from "@/lib/supabaseClient";

/**
 * category_sort_order 가 Supabase JS / 원시 REST 양쪽에서 동일하게 보이는지 디버그용.
 * SQL Editor에는 행이 있는데 API만 [] 일 때 원인 분리(스키마 캐시·URL·키 불일치 등).
 */
export async function probeCategorySortOrderAccess(): Promise<{
  restV1ListUrl: string;
  /** supabase-js, .from() — products 와 동일 패턴 */
  supabaseJsHeadCount: number | null;
  supabaseJsHeadError: string | null;
  /** fetch(GET) + service_role — PostgREST가 실제로 반환하는지 */
  rawRestStatus: number;
  rawRestRowCount: number | null;
  rawRestNotJsonSnippet: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const restV1ListUrl = url
    ? `${new URL(url).origin}/rest/v1/category_sort_order?select=category,position&order=position.asc`
    : "";

  let supabaseJsHeadCount: number | null = null;
  let supabaseJsHeadError: string | null = null;
  if (supabaseServer) {
    const { count, error } = await supabaseServer
      .from("category_sort_order")
      .select("*", { count: "exact", head: true });
    supabaseJsHeadCount = count ?? null;
    supabaseJsHeadError = error?.message ?? null;
  }

  let rawRestStatus = 0;
  let rawRestRowCount: number | null = null;
  let rawRestNotJsonSnippet: string | null = null;

  if (url && key) {
    try {
      const r = await fetch(restV1ListUrl, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      rawRestStatus = r.status;
      const text = await r.text();
      try {
        const parsed = JSON.parse(text) as unknown;
        rawRestRowCount = Array.isArray(parsed) ? parsed.length : null;
      } catch {
        rawRestNotJsonSnippet = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      }
    } catch (e) {
      rawRestNotJsonSnippet = String(e);
    }
  }

  return {
    restV1ListUrl,
    supabaseJsHeadCount,
    supabaseJsHeadError,
    rawRestStatus,
    rawRestRowCount,
    rawRestNotJsonSnippet,
  };
}
