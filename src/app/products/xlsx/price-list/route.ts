import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import { ExcelColumnWidthAccumulator } from "@/lib/excelDownloadColumnWidths";
import { applyExcelDownloadFontToWorksheet, writeStyledXlsxBuffer } from "@/lib/excelDownloadFont";
import { supabaseServer } from "@/lib/supabaseClient";
import * as XLSX from "xlsx-js-style";
import { normalizeCategoryLabel } from "../../categoryNormalize";
import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import {
  CATEGORY_ORDER_FALLBACK,
  mergeCategoryOrderMapForDisplay,
} from "../../categorySortOrder.utils";
import { normalizeSkuForMatch } from "../../skuNormalize";
import type { ProductVariant } from "../../types";
import { sortVariants } from "../../variantOptions";

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

type PriceListDebugReason = {
  sku: string;
  appProductCount: number;
  appVariantCount: number;
  allVariantsStockZero: boolean;
  hasVariantFallbackSource: boolean;
  productDetails: Array<{
    productId: string;
    productName: string;
    productSku: string;
    variantSkus: string[];
  }>;
  notes: string[];
};

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
  const sorted = sortVariants(variantsToProductVariants(p, variants));
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

function dominantNormSkuFromVariants(vars: DbVariant[]): string {
  const counts = new Map<string, number>();
  for (const v of vars) {
    const n = normalizeSkuForMatch(v.sku);
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
      continue;
    }
    if (c === bestCount && k < best) best = k;
  }
  return best;
}

function appLikeSkuKey(p: DbProduct, vars: DbVariant[]): string {
  const byProduct = normalizeSkuForMatch(p.sku);
  if (byProduct) return byProduct;
  return dominantNormSkuFromVariants(vars);
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

export async function GET(req: Request) {
  if (!supabaseServer) {
    return new Response("Supabase server client not ready.", { status: 503 });
  }
  const debugPriceList = new URL(req.url).searchParams.get("debugPriceList") === "1";

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
  if (debugPriceList) {
    let fetchedVariantCount = 0;
    for (const arr of variantsByProductId.values()) fetchedVariantCount += arr.length;
    console.info("[xlsx/price-list] fetched-counts", {
      fetchedProducts: list.length,
      fetchedVariants: fetchedVariantCount,
      fetchedVariantProductIdCount: variantsByProductId.size,
    });
  }

  const appSkuSet = new Set<string>();
  const priceListSkuSet = new Set<string>();
  const appSkuToProductCount = new Map<string, number>();
  const appSkuToVariantCount = new Map<string, number>();
  const appSkuHasVariantFallback = new Map<string, boolean>();
  const appSkuAllVariantStockZero = new Map<string, boolean>();
  const appSkuToProductDetails = new Map<
    string,
    Array<{ productId: string; productName: string; productSku: string; variantSkus: string[] }>
  >();
  for (const p of list) {
    const vars = variantsByProductId.get(p.id) ?? [];
    const appSku = appLikeSkuKey(p, vars);
    if (appSku) {
      appSkuSet.add(appSku);
      appSkuToProductCount.set(appSku, (appSkuToProductCount.get(appSku) ?? 0) + 1);
      appSkuToVariantCount.set(appSku, (appSkuToVariantCount.get(appSku) ?? 0) + vars.length);
      if (!normalizeSkuForMatch(p.sku) && dominantNormSkuFromVariants(vars)) {
        appSkuHasVariantFallback.set(appSku, true);
      }
      if (vars.length > 0) {
        const allZero = vars.every((v) => Math.max(0, Math.trunc(Number(v.stock) || 0)) <= 0);
        const prev = appSkuAllVariantStockZero.get(appSku);
        appSkuAllVariantStockZero.set(appSku, prev == null ? allZero : prev && allZero);
      }
      const detailList = appSkuToProductDetails.get(appSku) ?? [];
      const productName = ((p.name ?? "").trim() || p.sku).trim();
      const variantSkus = [...new Set(vars.map((v) => normalizeSkuForMatch(v.sku)).filter(Boolean))] as string[];
      detailList.push({
        productId: String(p.id),
        productName,
        productSku: String(p.sku ?? ""),
        variantSkus,
      });
      appSkuToProductDetails.set(appSku, detailList);
    }
    const skuInPriceList = normalizeSkuForMatch(p.sku);
    if (skuInPriceList) priceListSkuSet.add(skuInPriceList);
  }
  const missingFromPriceList = [...appSkuSet].filter((sku) => !priceListSkuSet.has(sku)).sort();
  const missingReasons: PriceListDebugReason[] = missingFromPriceList.map((sku) => {
    const notes: string[] = [];
    const appProductCount = appSkuToProductCount.get(sku) ?? 0;
    const appVariantCount = appSkuToVariantCount.get(sku) ?? 0;
    const allVariantsStockZero = appSkuAllVariantStockZero.get(sku) ?? false;
    const hasVariantFallbackSource = appSkuHasVariantFallback.get(sku) ?? false;
    const productDetails = appSkuToProductDetails.get(sku) ?? [];
    if (hasVariantFallbackSource) notes.push("products.sku 비어 variant.sku 다수결로 앱 SKU 산출");
    if (appProductCount > 1) notes.push("앱 SKU 병합 대상(동일 SKU 다중 product)");
    if (allVariantsStockZero) notes.push("옵션 전량 재고 0");
    if (notes.length === 0) notes.push("가격표 route에서 필터/품절제외/숨김 로직 없음, SKU 산출 경로 차이 우선 의심");
    return {
      sku,
      appProductCount,
      appVariantCount,
      allVariantsStockZero,
      hasVariantFallbackSource,
      productDetails,
      notes,
    };
  });
  if (debugPriceList) {
    console.info("[xlsx/price-list] sku-compare-summary", {
      appSkuCount: appSkuSet.size,
      priceListSkuCount: priceListSkuSet.size,
      missingSkuCount: missingFromPriceList.length,
      missingSkus: missingFromPriceList,
      // price-list route는 숨김/삭제/옵션병합/품절제외/필터조건으로 SKU를 제외하지 않는다.
      exclusionFlags: {
        hidden: false,
        deletedFilter: false,
        optionMergeFilter: false,
        soldOutExclusion: false,
        customFilterCondition: false,
      },
      missingReasons,
    });
    if (missingFromPriceList.length === 0) {
      console.info("[xlsx/price-list] missingSkus: none");
    } else {
      console.info("[xlsx/price-list] missingSkus (one-line)");
      missingFromPriceList.forEach((sku, idx) => {
        console.info(`  ${idx + 1}. ${sku}`);
      });
      console.info("[xlsx/price-list] missingReasons (one-line)");
      missingReasons.forEach((x, idx) => {
        const detailText =
          x.productDetails.length > 0
            ? x.productDetails
                .map(
                  (d) =>
                    `productId=${d.productId}, name="${d.productName}", products.sku="${d.productSku}", variantSkus=[${
                      d.variantSkus.join(", ") || "-"
                    }]`
                )
                .join(" | ")
            : "product details 없음";
        console.info(
          `  ${idx + 1}. sku=${x.sku} | appProductCount=${x.appProductCount} | appVariantCount=${x.appVariantCount} | allVariantsStockZero=${
            x.allVariantsStockZero
          } | variantFallback=${x.hasVariantFallbackSource} | notes=${x.notes.join("; ")} | ${detailText}`
        );
      });
    }
  }

  const ws: XLSX.WorkSheet = {};
  const enc = XLSX.utils.encode_cell;
  const colWidths = new ExcelColumnWidthAccumulator(HEADERS.length, [2, 3, 4]);
  for (let c = 0; c < HEADERS.length; c++) {
    colWidths.consider(c, HEADERS[c]);
  }

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

    colWidths.consider(0, cat);
    colWidths.consider(1, name);
    colWidths.consider(2, prices.wholesale);
    colWidths.consider(3, prices.sale);
    colWidths.consider(4, prices.minSale);
    colWidths.consider(5, note);

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
  if (debugPriceList) {
    console.info("[xlsx/price-list] export-summary", {
      exportedRowCount: Math.max(0, r - 1),
    });
  }

  const lastRow = Math.max(0, r - 1);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: HEADERS.length - 1 } });

  ws["!cols"] = colWidths.toCols();

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

  applyExcelDownloadFontToWorksheet(ws);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "가격표");

  const buffer = writeStyledXlsxBuffer(wb);

  const fname = `price-list_${formatDownloadFileNameDateYymmdd(new Date())}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
