import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import {
  ExcelColumnWidthAccumulator,
  EXCEL_COL_WCH_MAX,
} from "@/lib/excelDownloadColumnWidths";
import {
  EXCEL_COMMA_NUMBER_NUMFMT,
  EXCEL_DOWNLOAD_DATA_FONT_SZ,
  EXCEL_DOWNLOAD_FONT_NAME,
  EXCEL_DOWNLOAD_HEADER_FONT_SZ,
} from "@/lib/excelDownloadFont";
import { stripInvalidOneCellAnchorEditAsFromXlsxBuffer } from "@/lib/excelXlsxStripInvalidOneCellEditAs";
import { supabaseServer } from "@/lib/supabaseClient";
import ExcelJS from "exceljs";
import { unstable_noStore as noStore } from "next/cache";

import { normalizeCategoryLabel } from "../../../categoryNormalize";
import { fetchCategoryOrderMap } from "../../../categorySortOrder.server";
import {
  CATEGORY_ORDER_FALLBACK,
  mergeCategoryOrderMapForDisplay,
} from "../../../categorySortOrder.utils";
import type { ProductVariant } from "../../../types";
import { sortVariants } from "../../../variantOptions";
import {
  fetchProductImageThumbnailForExcel,
  PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH,
  PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT,
  productStockExcelImageOneCellTlNative,
  productStockExcelImageSquareExtPx,
} from "../../productStockExcelImageFetch";

export const dynamic = "force-dynamic";

const PRODUCTS_PAGE_SIZE = 1000;
const PRODUCT_VARIANTS_PAGE_SIZE = 1000;

const VARIANT_SELECT =
  "id, product_id, sku, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price";

const PRICE_HEADERS = ["카테고리", "품목명", "출고가", "판매가", "최하판매가", "비고"] as const;
const IMAGE_PRICE_HEADERS = ["이미지", ...PRICE_HEADERS] as const;

type DbProduct = {
  id: string;
  sku: string;
  category: string | null;
  name: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  wholesale_price: number | null;
  sale_price: number | null;
  extra_price: number | null;
  stock: number | null;
  created_at: string | null;
  updated_at: string | null;
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

type PriceRow = {
  product: DbProduct;
  cells: (string | number)[];
  numericCols0: readonly number[];
};

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE8E8E8" } };
const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};
const NORMAL_ROW_H = 16.5;
const IMAGE_ROW_H = PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT;

function toExcelNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function totalStockForProduct(p: DbProduct, variants: DbVariant[]): number {
  if (variants.length > 0) {
    let sum = 0;
    for (const v of variants) {
      sum += Math.max(0, Math.trunc(Number(v.stock) || 0));
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

async function fetchAllProducts(): Promise<{ rows: DbProduct[]; error: { message: string } | null }> {
  if (!supabaseServer) return { rows: [], error: { message: "Supabase not configured" } };
  const out: DbProduct[] = [];
  for (let offset = 0; ; offset += PRODUCTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("products")
      .select("id, sku, category, name, image_url, thumbnail_url, wholesale_price, sale_price, extra_price, stock, created_at, updated_at")
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

function buildPriceRows(list: DbProduct[], variantsByProductId: Map<string, DbVariant[]>): PriceRow[] {
  return list.map((p) => {
    const vars = variantsByProductId.get(p.id) ?? [];
    const cat = normalizeCategoryLabel(p.category);
    const name = ((p.name ?? "").trim() || p.sku).trim();
    const prices = resolvePrices(p, vars);
    const stock = totalStockForProduct(p, vars);
    const note = stock <= 0 ? "품절" : "";
    return {
      product: p,
      cells: [cat, name, prices.wholesale ?? "", prices.sale ?? "", prices.minSale ?? "", note],
      numericCols0: [2, 3, 4],
    };
  });
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number): void {
  row.height = NORMAL_ROW_H;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_HEADER_FONT_SZ, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  }
}

function styleDataCell(
  cell: ExcelJS.Cell,
  numeric: boolean,
  options?: { numericHorizontal?: "center" | "right" }
): void {
  cell.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_DATA_FONT_SZ };
  cell.alignment = {
    horizontal: numeric ? (options?.numericHorizontal ?? "center") : "center",
    vertical: "middle",
  };
  cell.border = THIN_BORDER;
  if (numeric && typeof cell.value === "number" && Number.isFinite(cell.value)) {
    cell.numFmt = EXCEL_COMMA_NUMBER_NUMFMT;
  }
}

function applyWorksheetView(ws: ExcelJS.Worksheet, colCount: number, rowCount: number): void {
  if (rowCount >= 2) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rowCount, column: colCount },
    };
  }
  ws.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
}

function createPriceSheet(workbook: ExcelJS.Workbook, rows: PriceRow[]): void {
  const ws = workbook.addWorksheet("가격표");
  const colWidths = new ExcelColumnWidthAccumulator(PRICE_HEADERS.length, [2, 3, 4]);

  const header = ws.getRow(1);
  for (let i = 0; i < PRICE_HEADERS.length; i++) {
    header.getCell(i + 1).value = PRICE_HEADERS[i];
    colWidths.consider(i, PRICE_HEADERS[i]);
  }
  styleHeaderRow(header, PRICE_HEADERS.length);

  rows.forEach((priceRow, idx) => {
    const row = ws.getRow(idx + 2);
    row.height = NORMAL_ROW_H;
    for (let c = 0; c < priceRow.cells.length; c++) {
      const value = priceRow.cells[c];
      row.getCell(c + 1).value = value;
      colWidths.consider(c, value);
      styleDataCell(row.getCell(c + 1), priceRow.numericCols0.includes(c), { numericHorizontal: "right" });
    }
  });

  const wchs = colWidths.toCols();
  for (let c = 0; c < PRICE_HEADERS.length; c++) {
    ws.getColumn(c + 1).width = wchs[c].wch;
  }
  applyWorksheetView(ws, PRICE_HEADERS.length, rows.length + 1);
}

function writeNoImageCell(row: ExcelJS.Row): void {
  const cell = row.getCell(1);
  cell.value = "NO IMAGE";
  cell.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_DATA_FONT_SZ, italic: true };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = THIN_BORDER;
}

function styleImageCell(row: ExcelJS.Row): void {
  const cell = row.getCell(1);
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = THIN_BORDER;
}

async function createImagePriceSheet(
  workbook: ExcelJS.Workbook,
  rows: PriceRow[],
  requestOrigin: string
): Promise<void> {
  const ws = workbook.addWorksheet("이미지 포함가격표");
  const colWidths = new ExcelColumnWidthAccumulator(IMAGE_PRICE_HEADERS.length, [3, 4, 5]);

  const header = ws.getRow(1);
  for (let i = 0; i < IMAGE_PRICE_HEADERS.length; i++) {
    header.getCell(i + 1).value = IMAGE_PRICE_HEADERS[i];
    colWidths.consider(i, IMAGE_PRICE_HEADERS[i]);
  }
  styleHeaderRow(header, IMAGE_PRICE_HEADERS.length);

  for (let i = 0; i < rows.length; i++) {
    const priceRow = rows[i];
    const excelRow = i + 2;
    const row = ws.getRow(excelRow);
    row.height = IMAGE_ROW_H;
    styleImageCell(row);

    for (let c = 0; c < priceRow.cells.length; c++) {
      const value = priceRow.cells[c];
      const targetCol = c + 2;
      row.getCell(targetCol).value = value;
      colWidths.consider(targetCol - 1, value);
      styleDataCell(row.getCell(targetCol), priceRow.numericCols0.includes(c));
    }

    try {
      const thumbBuf = await fetchProductImageThumbnailForExcel(
        {
          ...priceRow.product,
          msrp_price: null,
          memo: null,
          memo2: null,
          stock_updated_at: null,
        },
        requestOrigin
      );
      if (thumbBuf && thumbBuf.length > 0) {
        // @ts-expect-error exceljs `addImage` Buffer 타입이 Node 20+ generic Buffer와 맞지 않음(런타임은 정상)
        const imageId = workbook.addImage({ buffer: thumbBuf, extension: "jpeg" });
        const zr = excelRow - 1;
        const extPx = productStockExcelImageSquareExtPx();
        const imageRange = {
          editAs: "oneCell" as const,
          tl: productStockExcelImageOneCellTlNative(0, zr),
          ext: { width: extPx, height: extPx },
        };
        ws.addImage(imageId, imageRange as unknown as Parameters<ExcelJS.Worksheet["addImage"]>[1]);
      } else {
        writeNoImageCell(row);
      }
    } catch (e) {
      console.warn("[xlsx/price-list/with-images] 이미지 삽입 실패, NO IMAGE로 대체합니다.", priceRow.product.sku, e);
      writeNoImageCell(row);
    }
  }

  colWidths.consider(0, "이미지");
  colWidths.consider(0, "NO IMAGE");
  const fixedCols = new Map<number, number>([[0, PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH]]);
  const wchs = colWidths.toCols(fixedCols, { minWch: 2, pad: 0.75, maxWch: EXCEL_COL_WCH_MAX });
  for (let c = 0; c < IMAGE_PRICE_HEADERS.length; c++) {
    ws.getColumn(c + 1).width = wchs[c].wch;
  }
  applyWorksheetView(ws, IMAGE_PRICE_HEADERS.length, rows.length + 1);
}

export async function GET(req: Request) {
  noStore();
  if (!supabaseServer) {
    return new Response("Supabase server client not ready.", { status: 503 });
  }

  const categoryOrderFromDb = await fetchCategoryOrderMap();
  const { rows: products, error: productsErr } = await fetchAllProducts();
  if (productsErr) {
    return new Response(`이미지 포함 가격표 내보내기 실패: ${productsErr.message}`, { status: 500 });
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

  const { map: variantsByProductId, error: vErr } = await fetchVariantsByProductIds(list.map((p) => p.id));
  if (vErr) {
    return new Response(`이미지 포함 가격표 내보내기 실패: ${vErr.message}`, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  const rows = buildPriceRows(list, variantsByProductId);
  createPriceSheet(workbook, rows);
  await createImagePriceSheet(workbook, rows, new URL(req.url).origin);

  const raw = new Uint8Array(await workbook.xlsx.writeBuffer());
  const buffer = await stripInvalidOneCellAnchorEditAsFromXlsxBuffer(raw);
  const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="price-list_with_images_${yymmdd}.xlsx"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
