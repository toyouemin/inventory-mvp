import { supabaseServer } from "@/lib/supabaseClient";
import * as XLSX from "xlsx-js-style";
import { normalizeCategoryLabel } from "../../categoryNormalize";
import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import {
  CATEGORY_ORDER_FALLBACK,
  mergeCategoryOrderMapForDisplay,
} from "../../categorySortOrder.utils";
import type { ProductVariant } from "../../types";
import { sortVariantsForDisplay } from "../../variantOptions";

export const dynamic = "force-dynamic";

const PRODUCTS_PAGE_SIZE = 1000;
const PRODUCT_VARIANTS_PAGE_SIZE = 1000;

const VARIANT_SELECT =
  "id, product_id, sku, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price";

const HEADERS = ["카테고리", "품목명", "출고가", "판매가", "최하판매가", "비고"] as const;

type DbProduct = {
  id: string;
  sku: string;
  category: string | null;
  name: string | null;
  wholesale_price: number | null;
  sale_price: number | null;
  extra_price: number | null;
  stock: number | null;
  created_at: string | null;
};

type DbVariant = {
  id: string;
  product_id: string;
  sku: string | null;
  color: string | null;
  gender: string | null;
  size: string | null;
  stock: number | null;
  wholesale_price: number | null;
  msrp_price: number | null;
  sale_price: number | null;
  extra_price: number | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 서버 로컬 날짜 YYYY-MM-DD */
function priceListFilenameDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toExcelNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function totalStockForProduct(p: DbProduct, variants: DbVariant[]): number {
  if (variants.length > 0) {
    let sum = 0;
    for (const v of variants) {
      const q = Math.trunc(Number(v.stock) || 0);
      sum += Math.max(0, q);
    }
    return sum;
  }
  return Math.max(0, Math.trunc(Number(p.stock) || 0));
}

function variantsToProductVariants(p: DbProduct, rows: DbVariant[]): ProductVariant[] {
  return rows.map((v) => ({
    id: String(v.id),
    productId: String(v.product_id),
    sku: String(v.sku ?? p.sku ?? ""),
    color: String(v.color ?? ""),
    gender: String(v.gender ?? ""),
    size: String(v.size ?? ""),
    stock: Math.max(0, Math.trunc(Number(v.stock) || 0)),
    wholesalePrice: v.wholesale_price != null ? Number(v.wholesale_price) : null,
    msrpPrice: v.msrp_price != null ? Number(v.msrp_price) : null,
    salePrice: v.sale_price != null ? Number(v.sale_price) : null,
    extraPrice: v.extra_price != null ? Number(v.extra_price) : null,
  }));
}

/** 카드 상단 가격과 동일: 상품값 우선, 없으면 정렬된 첫 옵션 */
function resolvePrices(p: DbProduct, variants: DbVariant[]): {
  wholesale: number | null;
  sale: number | null;
  minSale: number | null;
} {
  const sorted = sortVariantsForDisplay(variantsToProductVariants(p, variants));
  const rep = sorted[0];
  return {
    wholesale: toExcelNumber(p.wholesale_price ?? rep?.wholesalePrice ?? null),
    sale: toExcelNumber(p.sale_price ?? rep?.salePrice ?? null),
    minSale: toExcelNumber(p.extra_price ?? rep?.extraPrice ?? null),
  };
}

function comparePriceListRows(a: DbProduct, b: DbProduct, orderMap: Record<string, number>): number {
  const aCat = normalizeCategoryLabel(a.category);
  const bCat = normalizeCategoryLabel(b.category);
  const ao = orderMap[aCat] ?? CATEGORY_ORDER_FALLBACK;
  const bo = orderMap[bCat] ?? CATEGORY_ORDER_FALLBACK;
  if (ao !== bo) return ao - bo;
  const na = ((a.name ?? "").trim() || a.sku).localeCompare((b.name ?? "").trim() || b.sku, "ko");
  if (na !== 0) return na;
  return (a.sku ?? "").localeCompare(b.sku ?? "", "ko");
}

async function fetchAllProducts(): Promise<{ rows: DbProduct[]; error: { message: string } | null }> {
  if (!supabaseServer) return { rows: [], error: { message: "Supabase not configured" } };
  const out: DbProduct[] = [];
  for (let offset = 0; ; offset += PRODUCTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("products")
      .select("id, sku, category, name, wholesale_price, sale_price, extra_price, stock, created_at")
      .order("sku", { ascending: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + PRODUCTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = (data ?? []) as DbProduct[];
    out.push(...chunk);
    if (chunk.length < PRODUCTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

async function fetchVariantsByProductIds(
  productIds: string[]
): Promise<{ map: Map<string, DbVariant[]>; error: { message: string } | null }> {
  const map = new Map<string, DbVariant[]>();
  if (!supabaseServer || productIds.length === 0) return { map, error: null };

  for (let offset = 0; ; offset += PRODUCT_VARIANTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("product_variants")
      .select(VARIANT_SELECT)
      .in("product_id", productIds)
      .order("id", { ascending: true })
      .range(offset, offset + PRODUCT_VARIANTS_PAGE_SIZE - 1);
    if (error) return { map: new Map(), error };
    const chunk = (data ?? []) as DbVariant[];
    for (const v of chunk) {
      const pid = String(v.product_id);
      const arr = map.get(pid) ?? [];
      arr.push(v);
      map.set(pid, arr);
    }
    if (chunk.length < PRODUCT_VARIANTS_PAGE_SIZE) break;
  }
  return { map, error: null };
}

const HEADER_STYLE = {
  font: { bold: true },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  fill: { patternType: "solid" as const, fgColor: { rgb: "FFE8E8E8" } },
};

const NUMBER_STYLE = {
  numFmt: "#,##0",
};

export async function GET() {
  if (!supabaseServer) {
    return new Response("Supabase server client not ready.", { status: 503 });
  }

  const categoryOrderFromDb = await fetchCategoryOrderMap();
  const { rows: products, error: productsErr } = await fetchAllProducts();
  if (productsErr) {
    return new Response(`가격표보내기 실패: ${productsErr.message}`, { status: 500 });
  }

  const seen = new Set<string>();
  const list = products.filter((p) => {
    const id = String(p.id ?? "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const categoryOrder = mergeCategoryOrderMapForDisplay(
    list.map((p) => ({ category: p.category, createdAt: p.created_at, id: p.id })),
    categoryOrderFromDb,
    { silent: true }
  );
  list.sort((a, b) => comparePriceListRows(a, b, categoryOrder));

  const productIds = list.map((p) => p.id);
  const { map: variantsByProductId, error: vErr } = await fetchVariantsByProductIds(productIds);
  if (vErr) {
    return new Response(`가격표보내기 실패: ${vErr.message}`, { status: 500 });
  }

  const ws: XLSX.WorkSheet = {};
  const enc = XLSX.utils.encode_cell;

  for (let c = 0; c < HEADERS.length; c++) {
    ws[enc({ r: 0, c })] = { v: HEADERS[c], t: "s", s: HEADER_STYLE };
  }

  let r = 1;
  for (const p of list) {
    const vars = variantsByProductId.get(p.id) ?? [];
    const cat = normalizeCategoryLabel(p.category);
    const name = ((p.name ?? "").trim() || p.sku).trim();
    const prices = resolvePrices(p, vars);
    const stock = totalStockForProduct(p, vars);
    const note = stock <= 0 ? "품절" : "";

    ws[enc({ r, c: 0 })] = { v: cat, t: "s" };
    ws[enc({ r, c: 1 })] = { v: name, t: "s" };

    if (prices.wholesale != null) {
      ws[enc({ r, c: 2 })] = { v: prices.wholesale, t: "n", s: NUMBER_STYLE };
    }
    if (prices.sale != null) {
      ws[enc({ r, c: 3 })] = { v: prices.sale, t: "n", s: NUMBER_STYLE };
    }
    if (prices.minSale != null) {
      ws[enc({ r, c: 4 })] = { v: prices.minSale, t: "n", s: NUMBER_STYLE };
    }
    if (note) {
      ws[enc({ r, c: 5 })] = { v: note, t: "s" };
    }
    r++;
  }

  const lastRow = Math.max(0, r - 1);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: HEADERS.length - 1 } });

  ws["!cols"] = [
    { wch: 20 },
    { wch: 40 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
  ];

  if (lastRow >= 1) {
    ws["!autofilter"] = { ref: `A1:F${lastRow + 1}` };
  }

  ws["!views"] = [
    {
      state: "frozen",
      ySplit: 1,
      topLeftCell: "A2",
      activePane: "bottomLeft",
      pane: "bottomLeft",
    },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "가격표");

  const buffer = XLSX.write(wb, {
    bookType: "xlsx",
    type: "buffer",
    cellStyles: true,
  }) as Buffer;

  const fname = `price-list-${priceListFilenameDate()}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
