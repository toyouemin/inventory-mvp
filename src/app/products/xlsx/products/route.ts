import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import { buildProductStockExcelColumnWidths } from "@/lib/excelDownloadColumnWidths";
import {
  applyExcelDownloadFontToWorksheet,
  applyHorizontalCenterToColumns,
  applyThousandsNumberFormatToColumns,
  PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS,
  PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS,
  writeStyledXlsxBuffer,
} from "@/lib/excelDownloadFont";
import * as XLSX from "xlsx-js-style";
import { unstable_noStore as noStore } from "next/cache";
import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import { compareProductsByCategoryOrder, mergeCategoryOrderMapForDisplay } from "../../categorySortOrder.utils";
import { sortVariants } from "../../variantOptions";
import { fetchAllProductsPaged, fetchVariantsByProductIdsPaged } from "../pagedFetch";

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

const IMAGE_URL_COL_INDEX = 3;

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
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

export async function GET(req: Request) {
  noStore();
  const categoryOrderFromDb = await fetchCategoryOrderMap();
  const debugVariantRows = new URL(req.url).searchParams.get("debugVariants") === "1";
  const { rows: products, error: productsErr } = await fetchAllProductsPaged<ProductRow>(
    "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at, stock_updated_at"
  );

  if (productsErr) {
    return new Response(`XLSX export failed: ${productsErr.message}`, { status: 500 });
  }

  const list = (products ?? []) as ProductRow[];
  if (debugVariantRows) {
    console.info("[xlsx/products] fetched-counts", {
      fetchedProducts: list.length,
    });
  }
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
    const { rows: variantsRows, error: variantsErr } = await fetchVariantsByProductIdsPaged<VariantRow>(
      productIds,
      "product_id, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2"
    );
    if (variantsErr) {
      return new Response(`XLSX export failed: ${variantsErr.message}`, { status: 500 });
    }
    variants = variantsRows;
    if (debugVariantRows) {
      console.info("[xlsx/products] fetched-counts", {
        fetchedVariants: variants.length,
        fetchedVariantProductIdCount: new Set(variants.map((v) => String(v.product_id))).size,
      });
    }
  }

  const variantsByProductId = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const arr = variantsByProductId.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProductId.set(v.product_id, arr);
  }

  const aoa: (string | number)[][] = [HEADER];
  const singleRowSkus: string[] = [];

  for (const p of list) {
    const productVariants = sortVariants(variantsByProductId.get(p.id) ?? []);
    if (debugVariantRows) {
      const variantLabels = productVariants.map((v) => `${(v.gender ?? "").trim()}/${(v.size ?? "").trim()}`);
      console.info("[xlsx/products] row-build", {
        sku: p.sku,
        productId: p.id,
        stock: Number(p.stock ?? 0),
        variantsLength: productVariants.length,
        variants: variantLabels,
      });
    }
    const name = (p.name ?? "").trim() || p.sku;
    // 분기 기준: variant 행이 1개 이상이면 무조건 variant 기준으로 출력
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
      singleRowSkus.push(p.sku);
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
      if (debugVariantRows) {
        console.warn("[xlsx/products] no-variant-single-row", {
          sku: p.sku,
          productId: p.id,
          stock: Number(p.stock ?? 0),
        });
      }
    }
  }
  if (debugVariantRows) {
    console.info("[xlsx/products] single-row-sku-summary", {
      totalSingleRowSkuCount: singleRowSkus.length,
      uniqueSingleRowSkuCount: new Set(singleRowSkus).size,
      skus: singleRowSkus,
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = buildProductStockExcelColumnWidths(aoa, IMAGE_URL_COL_INDEX);
  applyThousandsNumberFormatToColumns(ws, PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS);
  applyHorizontalCenterToColumns(ws, PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS);
  applyExcelDownloadFontToWorksheet(ws);
  XLSX.utils.book_append_sheet(wb, ws, "products");

  const buffer = writeStyledXlsxBuffer(wb);

  const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="products_${yymmdd}.xlsx"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
