import { supabaseServer } from "@/lib/supabaseClient";

export const PRODUCT_IMAGES_BUCKET = "product-images";

function supabaseProjectOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** `product-images` 버킷 공개 URL인지 판별 (동일 Supabase 프로젝트·표준 public 경로만 인정). */
export function isProductImagesBucketPublicUrl(imageUrl: string): boolean {
  const trimmed = imageUrl.trim();
  if (!trimmed) return false;
  const origin = supabaseProjectOrigin();
  if (!origin) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.origin !== origin) return false;
    const prefix = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
    return parsed.pathname.startsWith(prefix) && parsed.pathname.length > prefix.length;
  } catch {
    return false;
  }
}

/**
 * 공개 URL에서 Storage 객체 경로(버킷 루트 기준)를 추출.
 * 외부 URL·다른 버킷·`..` 등 비정상 경로는 null.
 */
export function extractProductImagesObjectPathFromPublicUrl(imageUrl: string): string | null {
  if (!isProductImagesBucketPublicUrl(imageUrl)) return null;
  try {
    const parsed = new URL(imageUrl.trim());
    const prefix = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
    const rest = parsed.pathname.slice(prefix.length);
    if (!rest || rest.includes("..")) return null;
    const decoded = decodeURIComponent(rest);
    if (!decoded || decoded.includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

export type RemoveReplacedProductImageResult = {
  /** Storage remove API를 호출했는지(대상이 우리 버킷이고 prev≠next였을 때) */
  deleteCalled: boolean;
  errorMessage?: string;
};

/**
 * DB에서 image_url 교체가 성공한 뒤 호출: 이전 URL이 product-images 공개 객체면 삭제 시도.
 * 삭제 실패 시에도 예외를 던지지 않음(호출부는 로깅·요약만).
 */
export async function removeReplacedProductImageFromStorage(params: {
  previousPublicUrl: string;
  newPublicUrl: string;
}): Promise<RemoveReplacedProductImageResult> {
  const prev = params.previousPublicUrl.trim();
  const next = params.newPublicUrl.trim();
  if (!prev || prev === next) {
    return { deleteCalled: false };
  }
  const objectPath = extractProductImagesObjectPathFromPublicUrl(prev);
  if (!objectPath) {
    return { deleteCalled: false };
  }

  const { error } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).remove([objectPath]);
  if (error) {
    console.error("[product-images] 교체 후 이전 객체 삭제 실패(DB는 이미 갱신됨)", {
      objectPath,
      message: error.message,
    });
    return { deleteCalled: true, errorMessage: error.message };
  }
  return { deleteCalled: true };
}

/**
 * 향후 확장: Storage `list`로 product-images 내 객체를 순회하고, DB `products.image_url`에서
 * 참조되지 않는 키를 골라 일괄 삭제하는 배치 작업을 여기에 두면 됨.
 * URL 판별·경로 추출은 `isProductImagesBucketPublicUrl` / `extractProductImagesObjectPathFromPublicUrl` 재사용.
 */
