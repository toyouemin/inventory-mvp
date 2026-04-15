import { buildProductStockExcelColumnWidths } from "@/lib/excelDownloadColumnWidths";
import {
  applyExcelDownloadFontToWorksheet,
  applyHorizontalCenterToColumns,
  applyThousandsNumberFormatToColumns,
  PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS,
  PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS,
  writeStyledXlsxBuffer,
} from "@/lib/excelDownloadFont";
import { supabaseServer } from "@/lib/supabaseClient";
import * as XLSX from "xlsx-js-style";
import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import { compareProductsByCategoryOrder, mergeCategoryOrderMapForDisplay } from "../../categorySortOrder.utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRODUCTS_PAGE_SIZE = 1000;
const PRODUCT_VARIANTS_PAGE_SIZE = 1000;
const PRODUCT_ID_BATCH_SIZE = 200;

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
];

const IMAGE_URL_COL_INDEX = 3;

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

async function fetchAllProducts(): Promise<{ rows: ProductRow[]; error: { message: string } | null }> {
  const out: ProductRow[] = [];
  for (let offset = 0; ; offset += PRODUCTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("products")
      .select(
        "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at"
      )
      .order("sku", { ascending: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + PRODUCTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = (data ?? []) as ProductRow[];
    out.push(...chunk);
    if (chunk.length < PRODUCTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

async function fetchVariantsByProductIds(
  productIds: string[]
): Promise<{ rows: VariantRow[]; error: { message: string } | null }> {
  if (productIds.length === 0) return { rows: [], error: null };
  const out: VariantRow[] = [];
  for (let start = 0; start < productIds.length; start += PRODUCT_ID_BATCH_SIZE) {
    const batchIds = productIds.slice(start, start + PRODUCT_ID_BATCH_SIZE);
    for (let offset = 0; ; offset += PRODUCT_VARIANTS_PAGE_SIZE) {
      const { data, error } = await supabaseServer
        .from("product_variants")
        .select(
          "product_id, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2"
        )
        .in("product_id", batchIds)
        .order("product_id", { ascending: true })
        .order("color", { ascending: true })
        .order("gender", { ascending: true })
        .order("size", { ascending: true })
        .range(offset, offset + PRODUCT_VARIANTS_PAGE_SIZE - 1);
      if (error) return { rows: [], error };
      const chunk = (data ?? []) as VariantRow[];
      out.push(...chunk);
      if (chunk.length < PRODUCT_VARIANTS_PAGE_SIZE) break;
    }
  }
  return { rows: out, error: null };
}

export async function GET() {
  const categoryOrderFromDb = await fetchCategoryOrderMap();

  const { rows: products, error: productsErr } = await fetchAllProducts();

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
    const { rows: variantsRows, error: variantsErr } = await fetchVariantsByProductIds(productIds);
    if (variantsErr) {
      return new Response(`XLSX export failed: ${variantsErr.message}`, { status: 500 });
    }
    variants = variantsRows;
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
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = buildProductStockExcelColumnWidths(aoa, IMAGE_URL_COL_INDEX);
  applyThousandsNumberFormatToColumns(ws, PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS);
  applyHorizontalCenterToColumns(ws, PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS);
  applyExcelDownloadFontToWorksheet(ws);
  XLSX.utils.book_append_sheet(wb, ws, "stock");

  const buffer = writeStyledXlsxBuffer(wb);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="stock.xlsx"',
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
