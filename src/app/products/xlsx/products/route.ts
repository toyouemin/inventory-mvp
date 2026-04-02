import { supabaseServer } from "@/lib/supabaseClient";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function excelCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  // 숫자처럼 보이는 값만 숫자로 넣기(엑셀 정렬/계산 편의)
  const n = Number(s);
  if (Number.isFinite(n) && s.trim() !== "") return n;
  return s;
}

export async function GET() {
  const { data: products, error: productsErr } = await supabaseServer
    .from("products")
    .select(
      "id, sku, category, name_spec, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock"
    )
    .order("sku", { ascending: true });

  if (productsErr) {
    return new Response(`XLSX export failed: ${productsErr.message}`, { status: 500 });
  }

  const list = products ?? [];
  const productIds = list.map((p: any) => p.id);

  let variants: { product_id: string; size: string; stock: number; memo: string | null; memo2: string | null }[] = [];
  if (productIds.length > 0) {
    const { data: variantsData } = await supabaseServer
      .from("product_variants")
      .select("product_id, size, stock, memo, memo2")
      .in("product_id", productIds);
    variants = variantsData ?? [];
  }

  const variantsByProductId = new Map<
    string,
    { size: string; stock: number; memo: string | null; memo2: string | null }[]
  >();
  for (const v of variants) {
    const arr = variantsByProductId.get(v.product_id) ?? [];
    arr.push({
      size: v.size,
      stock: Number(v.stock) ?? 0,
      memo: v.memo ?? null,
      memo2: v.memo2 ?? null,
    });
    variantsByProductId.set(v.product_id, arr);
  }

  const header = [
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

  const aoa: (string | number)[][] = [header];

  for (const p of list) {
    const productVariants = variantsByProductId.get(p.id) ?? [];
    if (productVariants.length > 0) {
      for (const v of productVariants) {
        aoa.push([
          excelCell(p.sku),
          excelCell(p.category),
          excelCell(p.name_spec ?? p.sku),
          excelCell(p.image_url),
          excelCell(v.size),
          excelCell(v.stock),
          excelCell(p.wholesale_price ?? ""),
          excelCell(p.msrp_price ?? ""),
          excelCell(p.sale_price ?? ""),
          excelCell(p.extra_price ?? ""),
          excelCell(v.memo ?? ""),
          excelCell(v.memo2 ?? ""),
        ]);
      }
    } else {
      aoa.push([
        excelCell(p.sku),
        excelCell(p.category),
        excelCell(p.name_spec ?? p.sku),
        excelCell(p.image_url),
        "",
        excelCell(p.stock ?? 0),
        excelCell(p.wholesale_price ?? ""),
        excelCell(p.msrp_price ?? ""),
        excelCell(p.sale_price ?? ""),
        excelCell(p.extra_price ?? ""),
        excelCell(p.memo ?? ""),
        excelCell(p.memo2 ?? ""),
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "products");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="products.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

