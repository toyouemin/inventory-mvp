import { fetchCategoryOrderMap } from "../../categorySortOrder.server";
import { compareProductsByCategoryOrder, mergeCategoryOrderMapForDisplay } from "../../categorySortOrder.utils";
import { fetchAllProductsPaged, fetchVariantsByProductIdsPaged } from "../../xlsx/pagedFetch";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown) {
  const s = (v ?? "").toString();
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 업로드 템플릿과 동일 헤더 */
const CSV_HEADER =
  "SKU,카테고리,상품명,이미지url,color,gender,size,stock,wholesalePrice,msrpPrice,salePrice,extraPrice,memo,memo2";

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

export async function GET(req: Request) {
  const categoryOrderFromDb = await fetchCategoryOrderMap();
  const debugCsv = new URL(req.url).searchParams.get("debugCsv") === "1";

  const { rows: products, error: productsErr } = await fetchAllProductsPaged<ProductRow>(
    "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at"
  );

  if (productsErr) {
    return new Response(`CSV export failed: ${productsErr.message}`, { status: 500 });
  }

  const list = (products ?? []) as ProductRow[];
  if (debugCsv) {
    console.info("[csv/products] fetched-counts", { fetchedProducts: list.length });
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
      return new Response(`CSV export failed: ${variantsErr.message}`, { status: 500 });
    }
    variants = variantsRows;
    if (debugCsv) {
      console.info("[csv/products] fetched-counts", {
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

  const rows: string[][] = [];
  const singleRowSkus: string[] = [];
  for (const p of list) {
    const productVariants = variantsByProductId.get(p.id) ?? [];
    const name = (p.name ?? "").trim() || p.sku;
    // 분기 기준: variant 행이 1개 이상이면 무조건 variant 행 생성
    if (productVariants.length > 0) {
      for (const v of productVariants) {
        rows.push([
          csvEscape(p.sku),
          csvEscape(p.category ?? ""),
          csvEscape(name),
          csvEscape(p.image_url ?? ""),
          csvEscape(v.color ?? ""),
          csvEscape(v.gender ?? ""),
          csvEscape(v.size ?? ""),
          csvEscape(Number(v.stock) || 0),
          csvEscape(v.wholesale_price ?? ""),
          csvEscape(v.msrp_price ?? ""),
          csvEscape(v.sale_price ?? ""),
          csvEscape(v.extra_price ?? ""),
          csvEscape(v.memo ?? ""),
          csvEscape(v.memo2 ?? ""),
        ]);
      }
    } else {
      singleRowSkus.push(p.sku);
      rows.push([
        csvEscape(p.sku),
        csvEscape(p.category ?? ""),
        csvEscape(name),
        csvEscape(p.image_url ?? ""),
        "",
        "",
        "",
        csvEscape(Number(p.stock) || 0),
        csvEscape(p.wholesale_price ?? ""),
        csvEscape(p.msrp_price ?? ""),
        csvEscape(p.sale_price ?? ""),
        csvEscape(p.extra_price ?? ""),
        csvEscape(p.memo ?? ""),
        csvEscape(p.memo2 ?? ""),
      ]);
    }
  }
  if (debugCsv) {
    console.info("[csv/products] single-row-sku-summary", {
      totalSingleRowSkuCount: singleRowSkus.length,
      uniqueSingleRowSkuCount: new Set(singleRowSkus).size,
      skus: singleRowSkus,
    });
  }

  const lines = [CSV_HEADER, ...rows.map((r) => r.join(","))];
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
