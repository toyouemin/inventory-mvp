import { supabaseServer } from "@/lib/supabaseClient";
import * as XLSX from "xlsx";
import { unstable_noStore as noStore } from "next/cache";
import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import { compareProductsByCategoryOrder, mergeCategoryOrderMapForDisplay } from "../../categorySortOrder.utils";

export const dynamic = "force-dynamic";

function excelCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  const n = Number(s);
  if (Number.isFinite(n) && s.trim() !== "") return n;
  return s;
}

const HEADER = [
  "SKU",
  "카테고리",
  "상품명",
  "이미지url",
  "color",
  "gender",
  "size",
  "stock",
  "wholesalePrice",
  "msrpPrice",
  "salePrice",
  "extraPrice",
  "memo",
  "memo2",
  "수량변경일",
];

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

type ProductRow = {
  id: string;
  sku: string;
  category: string | null;
  name: string | null;
  image_url: string | null;
  wholesale_price: number | null;
  msrp_price: number | null;
  sale_price: number | null;
  extra_price: number | null;
  memo: string | null;
  memo2: string | null;
  stock: number | null;
  created_at: string | null;
  updated_at: string | null;
  stock_updated_at: string | null;
};

type VariantRow = {
  product_id: string;
  color: string | null;
  gender: string | null;
  size: string | null;
  stock: number;
  wholesale_price: number | null;
  msrp_price: number | null;
  sale_price: number | null;
  extra_price: number | null;
  memo: string | null;
  memo2: string | null;
};

export async function GET() {
  noStore();
  const categoryOrderFromDb = await fetchCategoryOrderMap();

  const { data: products, error: productsErr } = await supabaseServer
    .from("products")
    .select(
      "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at, stock_updated_at"
    )
    .order("sku", { ascending: true });

  if (productsErr) {
    return new Response(`XLSX export failed: ${productsErr.message}`, { status: 500 });
  }

  const list = (products ?? []) as ProductRow[];
  const categoryOrder = mergeCategoryOrderMapForDisplay(
    list.map((p) => ({ category: p.category, createdAt: p.created_at, id: p.id })),
    categoryOrderFromDb
  );
  list.sort((a, b) =>
    compareProductsByCategoryOrder(
      { category: a.category, sku: a.sku, createdAt: a.created_at },
      { category: b.category, sku: b.sku, createdAt: b.created_at },
      categoryOrder
    )
  );
  const productIds = list.map((p) => p.id);

  let variants: VariantRow[] = [];
  if (productIds.length > 0) {
    const { data: variantsData } = await supabaseServer
      .from("product_variants")
      .select(
        "product_id, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2"
      )
      .in("product_id", productIds);
    variants = (variantsData ?? []) as VariantRow[];
  }

  const variantsByProductId = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const arr = variantsByProductId.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProductId.set(v.product_id, arr);
  }

  const aoa: (string | number)[][] = [HEADER];

  for (const p of list) {
    const productVariants = variantsByProductId.get(p.id) ?? [];
    const name = (p.name ?? "").trim() || p.sku;
    if (productVariants.length > 0) {
      for (const v of productVariants) {
        aoa.push([
          excelCell(p.sku),
          excelCell(p.category ?? ""),
          excelCell(name),
          excelCell(p.image_url ?? ""),
          excelCell(v.color ?? ""),
          excelCell(v.gender ?? ""),
          excelCell(v.size ?? ""),
          excelCell(Number(v.stock) || 0),
          excelCell(v.wholesale_price ?? ""),
          excelCell(v.msrp_price ?? ""),
          excelCell(v.sale_price ?? ""),
          excelCell(v.extra_price ?? ""),
          excelCell(v.memo ?? ""),
          excelCell(v.memo2 ?? ""),
          excelCell(formatUpdatedAt(p.stock_updated_at)),
        ]);
      }
    } else {
      aoa.push([
        excelCell(p.sku),
        excelCell(p.category ?? ""),
        excelCell(name),
        excelCell(p.image_url ?? ""),
        "",
        "",
        "",
        excelCell(Number(p.stock) || 0),
        excelCell(p.wholesale_price ?? ""),
        excelCell(p.msrp_price ?? ""),
        excelCell(p.sale_price ?? ""),
        excelCell(p.extra_price ?? ""),
        excelCell(p.memo ?? ""),
        excelCell(p.memo2 ?? ""),
        excelCell(formatUpdatedAt(p.stock_updated_at)),
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
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
