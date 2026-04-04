import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseClient";

type DebugProductRow = Record<string, unknown>;

function mapProduct(row: DebugProductRow) {
  const sku = String(row.sku ?? "");
  const rawImageUrl = (row.image_url as string) ?? null;
  const fallbackImagePath = `/images/${encodeURIComponent(sku)}.jpg`;
  const imageUrl =
    rawImageUrl && rawImageUrl.trim() !== "" && rawImageUrl !== fallbackImagePath ? rawImageUrl : null;

  return {
    id: String(row.id),
    sku,
    category: (row.category as string) ?? null,
    name: String((row.name as string) ?? sku ?? ""),
    imageUrl,
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    stock: row.stock != null ? Number(row.stock) : 0,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
  };
}

function mapVariant(row: DebugProductRow) {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    sku: String(row.sku ?? ""),
    color: String(row.color ?? ""),
    gender: String(row.gender ?? ""),
    size: String(row.size ?? ""),
    stock: Number(row.stock ?? 0),
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/debug/products?sku=...
 * - localhost / production에서 같은 SKU의
 *   1) products 조회 raw 결과
 *   2) product_variants 조회 raw 결과
 *   3) page.tsx에서 만들 props 형태(매핑 결과)
 *   를 JSON으로 비교할 수 있게 합니다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku")?.trim() ?? "";
  if (!sku) {
    return NextResponse.json(
      { ok: false, error: "Missing query param: sku" },
      { status: 400 }
    );
  }

  // 민감값 노출 없이 “환경 차이”를 관찰하기 위한 최소 정보만 제공합니다.
  const debugEnv = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    nodeEnv: process.env.NODE_ENV ?? null,
  };

  try {
    // products 페이지와 동일한 컬럼 선택(최소한 같게 맞춤)
    const { data: productsData, error: productsError } = await supabaseServer
      .from("products")
      .select(
        "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at"
      )
      .eq("sku", sku)
      .order("created_at", { ascending: false });

    if (productsError) {
      return NextResponse.json(
        { ok: false, error: productsError.message, debugEnv },
        { status: 500 }
      );
    }

    const productsRows = (productsData ?? []) as DebugProductRow[];
    const productsMapped = productsRows.map(mapProduct);
    const productIds = productsMapped.map((p) => p.id);

    let variantsRows: DebugProductRow[] = [];
    if (productIds.length > 0) {
      const { data: variantsData, error: variantsError } = await supabaseServer
        .from("product_variants")
        .select(
          "id, product_id, sku, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, created_at"
        )
        .in("product_id", productIds);

      if (variantsError) {
        return NextResponse.json(
          { ok: false, error: variantsError.message, debugEnv },
          { status: 500 }
        );
      }
      variantsRows = (variantsData ?? []) as DebugProductRow[];
    }

    const variantsMapped = variantsRows.map(mapVariant);
    const variantsByProductId: Record<string, typeof variantsMapped> = {};
    for (const v of variantsMapped) {
      if (!variantsByProductId[v.productId]) variantsByProductId[v.productId] = [];
      variantsByProductId[v.productId].push(v);
    }

    const body = {
      ok: true,
      now: new Date().toISOString(),
      sku,
      debugEnv,
      // “조회 원본”
      productsQueryRows: productsRows,
      variantsQueryRows: variantsRows,
      // “렌더링 props에 들어가는 매핑 결과” (page.tsx 로직의 대응)
      props: {
        products: productsMapped,
        variantsByProductId,
      },
    };

    // 서버 콘솔에서도 확인 가능하도록(로컬/배포 둘 다) 로그 추가
    console.log("[api-debug/products]", { sku, productCount: productsMapped.length, variantCount: variantsMapped.length });

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, debugEnv },
      { status: 500 }
    );
  }
}

