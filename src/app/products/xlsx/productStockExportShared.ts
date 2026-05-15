import { fetchCategoryOrderMap } from "../categorySortOrder.server";
import { compareProductsByCategoryOrder, mergeCategoryOrderMapForDisplay } from "../categorySortOrder.utils";
import { sortVariants } from "../variantOptions";
import { fetchAllProductsPaged, fetchVariantsByProductIdsPaged } from "./pagedFetch";

export type ProductStockExportProductRow = {
  id: string;
  sku: string;
  category: string | null;
  name: string | null;
  image_url: string | null;
  /** 엑셀 삽입용 `product-images/thumbs/{stem}.jpg` 공개 URL — 없으면 `image_url`로 폴백 */
  thumbnail_url: string | null;
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

export type ProductStockExportVariantRow = {
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

/** `aoa` 데이터 행(헤더 제외)과 동일한 순서 — 이미지 시트는 상품의 대표 `image_url`만 사용 */
export type ProductStockExportImageLine = {
  product: ProductStockExportProductRow;
  variant: ProductStockExportVariantRow | null;
};

/** 첫 시트(상품재고)·CSV·단일 xlsx — 기존 열 순서 유지 */
export const PRODUCT_STOCK_EXPORT_HEADER = [
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
] as const;

export const PRODUCT_STOCK_IMAGE_URL_COL_INDEX = 3;

export function excelCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  const n = Number(s);
  if (Number.isFinite(n) && s.trim() !== "") return n;
  return s;
}

export function formatProductStockUpdatedAt(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export async function loadProductStockExportBundle(options: {
  debugVariantRows: boolean;
}): Promise<{
  aoa: (string | number)[][];
  imageLines: ProductStockExportImageLine[];
  error: { message: string } | null;
}> {
  const categoryOrderFromDb = await fetchCategoryOrderMap();
  const { rows: products, error: productsErr } = await fetchAllProductsPaged<ProductStockExportProductRow>(
    "id, sku, category, name, image_url, thumbnail_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at, stock_updated_at"
  );

  if (productsErr) {
    return { aoa: [], imageLines: [], error: productsErr };
  }

  const list = (products ?? []) as ProductStockExportProductRow[];
  if (options.debugVariantRows) {
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
  let variants: ProductStockExportVariantRow[] = [];
  if (productIds.length > 0) {
    const { rows: variantsRows, error: variantsErr } = await fetchVariantsByProductIdsPaged<ProductStockExportVariantRow>(
      productIds,
      "product_id, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2"
    );
    if (variantsErr) {
      return { aoa: [], imageLines: [], error: variantsErr };
    }
    variants = variantsRows;
    if (options.debugVariantRows) {
      console.info("[xlsx/products] fetched-counts", {
        fetchedVariants: variants.length,
        fetchedVariantProductIdCount: new Set(variants.map((v) => String(v.product_id))).size,
      });
    }
  }

  const variantsByProductId = new Map<string, ProductStockExportVariantRow[]>();
  for (const v of variants) {
    const arr = variantsByProductId.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProductId.set(v.product_id, arr);
  }

  const aoa: (string | number)[][] = [[...PRODUCT_STOCK_EXPORT_HEADER]];
  const imageLines: ProductStockExportImageLine[] = [];
  const singleRowSkus: string[] = [];

  for (const p of list) {
    const productVariants = sortVariants(variantsByProductId.get(p.id) ?? []);
    if (options.debugVariantRows) {
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
          excelCell(formatProductStockUpdatedAt(p.stock_updated_at)),
        ]);
        imageLines.push({ product: p, variant: v });
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
        excelCell(formatProductStockUpdatedAt(p.stock_updated_at)),
      ]);
      imageLines.push({ product: p, variant: null });
      if (options.debugVariantRows) {
        console.warn("[xlsx/products] no-variant-single-row", {
          sku: p.sku,
          productId: p.id,
          stock: Number(p.stock ?? 0),
        });
      }
    }
  }

  if (options.debugVariantRows) {
    console.info("[xlsx/products] single-row-sku-summary", {
      totalSingleRowSkuCount: singleRowSkus.length,
      uniqueSingleRowSkuCount: new Set(singleRowSkus).size,
      skus: singleRowSkus,
    });
  }

  return { aoa, imageLines, error: null };
}
