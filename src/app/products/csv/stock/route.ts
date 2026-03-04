import { supabaseServer } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  if (!supabaseServer) {
    return new Response("Supabase server client not ready. Check env vars.", { status: 500 });
  }

  const { data, error } = await supabaseServer
    .from("products")
    .select("sku, name_spec, stock")
    .order("sku", { ascending: true });

  if (error) {
    return new Response(`Supabase error: ${error.message}`, { status: 500 });
  }

  const rows = data ?? [];

  // 엑셀 깨짐 방지 BOM
  const header = ["sku", "nameSpec", "stock"];
  const lines = [
    header.join(","),
    ...rows.map((r: any) =>
      [r.sku, r.name_spec ?? r.sku, r.stock ?? 0].map(csvEscape).join(",")
    ),
  ];

  const csv = "\uFEFF" + lines.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stock.csv"',
      "Cache-Control": "no-store",
    },
  });
}