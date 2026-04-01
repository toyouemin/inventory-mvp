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

const CSV_HEADER = [
  "sku",
  "category",
  "name",
  "imageUrl",
  "size",
  "stock",
  "wholesalePrice",
  "msrpPrice",
  "salePrice",
  "extraPrice",
  "memo",
  "memo2",
];

export async function GET() {
  const { data: products, error: productsErr } = await supabaseServer
    .from("products")
    .select("id, sku, category, name_spec, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock")
    .order("sku", { ascending: true });

  if (productsErr) {
    return new Response(`CSV export failed: ${productsErr.message}`, { status: 500 });
  }

  const list = products ?? [];
  const productIds = list.map((p: { id: string }) => p.id);

  let variants: { product_id: string; size: string; stock: number; memo: string | null; memo2: string | null }[] = [];
  if (productIds.length > 0) {
    const { data: variantsData } = await supabaseServer
      .from("product_variants")
      .select("product_id, size, stock, memo, memo2")
      .in("product_id", productIds);
    variants = variantsData ?? [];
  }

  const variantsByProductId = new Map<string, { size: string; stock: number; memo: string | null; memo2: string | null }[]>();
  for (const v of variants) {
    const arr = variantsByProductId.get(v.product_id) ?? [];
    arr.push({ size: v.size, stock: Number(v.stock) ?? 0, memo: v.memo ?? null, memo2: v.memo2 ?? null });
    variantsByProductId.set(v.product_id, arr);
  }

  const rows: string[][] = [];
  for (const p of list) {
    const productVariants = variantsByProductId.get(p.id) ?? [];
    if (productVariants.length > 0) {
      for (const v of productVariants) {
        rows.push([
          csvEscape(p.sku),
          csvEscape(p.category),
          csvEscape(p.name_spec ?? p.sku),
          csvEscape(p.image_url),
          csvEscape(v.size),
          csvEscape(v.stock),
          csvEscape(p.wholesale_price ?? ""),
          csvEscape(p.msrp_price ?? ""),
          csvEscape(p.sale_price ?? ""),
          csvEscape(p.extra_price ?? ""),
          csvEscape(v.memo ?? ""),
          csvEscape(v.memo2 ?? ""),
        ]);
      }
    } else {
      rows.push([
        csvEscape(p.sku),
        csvEscape(p.category),
        csvEscape(p.name_spec ?? p.sku),
        csvEscape(p.image_url),
        "",
        csvEscape(p.stock ?? 0),
        csvEscape(p.wholesale_price ?? ""),
        csvEscape(p.msrp_price ?? ""),
        csvEscape(p.sale_price ?? ""),
        csvEscape(p.extra_price ?? ""),
        csvEscape(p.memo ?? ""),
        csvEscape(p.memo2 ?? ""),
      ]);
    }
  }

  const lines = [CSV_HEADER.join(","), ...rows.map((r) => r.join(","))];
  const csv = "\uFEFF" + lines.join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products.csv"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
