import { filterFailedProductImageCandidates } from "./imageLoadFailureCache";
import { normalizeSkuForMatch } from "./skuNormalize";

/**
 * 상품 이미지 URL 후보 (앞에서부터 시도).
 *
 * 1. `products.image_url` (비어 있지 않을 때만)
 * 2. `localImageHrefBySkuLower[normalizeSkuForMatch(sku)]` — `public/images` 스캔 맵(전달된 경우만, 빈 객체 포함).
 *    맵이 전달되면 추측 URL은 넣지 않음(404 연쇄 방지).
 * 3. 맵이 `undefined`일 때만 호환용 `/images/{정규화SKU}.jpg` → `.jpeg` → `.png` → `.webp`
 *
 * placeholder는 후보가 없을 때 훅/컴포넌트에서 처리.
 */
export function buildProductImageCandidates(
  sku: string,
  imageUrl: string | null | undefined,
  updatedAt?: string | null,
  localImageHrefBySkuLower?: Record<string, string>
): string[] {
  const out: string[] = [];
  const u = (imageUrl ?? "").trim();
  if (u) {
    if (updatedAt?.trim()) {
      try {
        const parsed = new URL(u, "http://local");
        parsed.searchParams.set("v", updatedAt.trim());
        const withVersion = parsed.toString().replace(/^http:\/\/local/, "");
        out.push(withVersion);
      } catch {
        out.push(u);
      }
    } else {
      out.push(u);
    }
  }

  const normSku = normalizeSkuForMatch(sku);
  if (!normSku) return out;

  if (localImageHrefBySkuLower !== undefined) {
    const href = localImageHrefBySkuLower[normSku];
    if (href && !out.includes(href)) out.push(href);
    return out;
  }

  const enc = encodeURIComponent(normSku);
  for (const ext of ["jpg", "jpeg", "png", "webp"] as const) {
    const path = `/images/${enc}.${ext}`;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** 첫 번째 후보만 필요할 때(비권장: UI는 useProductImageSrc 사용) */
export function productDisplayImageSrc(
  sku: string,
  imageUrl: string | null | undefined,
  updatedAt?: string | null,
  localImageHrefBySkuLower?: Record<string, string>
): string {
  const c = filterFailedProductImageCandidates(
    buildProductImageCandidates(sku, imageUrl, updatedAt, localImageHrefBySkuLower)
  );
  return c[0] ?? "";
}
