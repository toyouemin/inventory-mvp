import { supabaseServer } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function csvEscape(v: unknown) {
  const s = (v ?? "").toString();
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const { data, error } = await supabaseServer
    .from("products")
    .select("sku, category, name_spec, wholesale_price, msrp_price, sale_price, memo, stock")
    .order("sku", { ascending: true });

  if (error) {
    return new Response(`CSV export failed: ${error.message}`, { status: 500 });
  }

  const header = [
    "sku",
    "category",
    "nameSpec",
    "wholesalePrice",
    "msrpPrice",
    "salePrice",
    "memo",
    "stock",
  ];

  const lines = [
    header.join(","),
    ...(data ?? []).map((r: any) =>
      [
        csvEscape(r.sku),
        csvEscape(r.category),
        csvEscape(r.name_spec),
        csvEscape(r.wholesale_price),
        csvEscape(r.msrp_price),
        csvEscape(r.sale_price),
        csvEscape(r.memo),
        csvEscape(r.stock ?? 0),
      ].join(",")
    ),
  ];

  // 엑셀 한글 깨짐 방지
  const csv = "\uFEFF" + lines.join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products.csv"`,

      // ✅ 캐시 완전 차단
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}