import { supabaseServer } from "@/lib/supabaseClient";

export const PRODUCT_IMAGES_BUCKET = "product-images";
/** Storage 빈 폴더 유지용 — 점검·통계·orphan 비교에서 제외 */
export const PRODUCT_IMAGES_EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

const STORAGE_PUBLIC_PREFIX = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;

export function isProductImagesEmptyFolderPlaceholderPath(path: string): boolean {
  const base = (path.split("/").pop() ?? "").trim();
  return base === PRODUCT_IMAGES_EMPTY_FOLDER_PLACEHOLDER;
}

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
    return parsed.pathname.startsWith(STORAGE_PUBLIC_PREFIX) && parsed.pathname.length > STORAGE_PUBLIC_PREFIX.length;
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
    const rest = parsed.pathname.slice(STORAGE_PUBLIC_PREFIX.length);
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

function normalizeStorageObjectPath(path: string): string | null {
  const p = path.trim().replace(/^\/+/, "");
  if (!p || p.includes("..")) return null;
  try {
    const decoded = decodeURIComponent(p);
    if (!decoded || decoded.includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * image_url/raw ref에서 product-images 버킷 object path를 안전하게 추출.
 * 허용:
 * - 전체 public URL
 * - /storage/v1/object/public/product-images/<path>
 * - product-images/<path>
 * - <path> (상대 경로)
 */
export function extractProductImagesObjectPathFromAnyRef(rawRef: string): string | null {
  const raw = String(rawRef ?? "").trim();
  if (!raw) return null;

  const directPublic = extractProductImagesObjectPathFromPublicUrl(raw);
  if (directPublic) return directPublic;

  const origin = supabaseProjectOrigin();
  const maybePathOnly = (() => {
    try {
      const url = new URL(raw);
      if (origin && url.origin !== origin) return null;
      return `${url.pathname}${url.search ?? ""}`;
    } catch {
      return raw;
    }
  })();
  if (!maybePathOnly) return null;

  const withoutQuery = maybePathOnly.split("?")[0]?.split("#")[0] ?? "";
  const decodedWhole = (() => {
    try {
      return decodeURIComponent(withoutQuery);
    } catch {
      return withoutQuery;
    }
  })();

  if (decodedWhole.startsWith(STORAGE_PUBLIC_PREFIX)) {
    return normalizeStorageObjectPath(decodedWhole.slice(STORAGE_PUBLIC_PREFIX.length));
  }

  if (decodedWhole.startsWith(`/${PRODUCT_IMAGES_BUCKET}/`)) {
    return normalizeStorageObjectPath(decodedWhole.slice(PRODUCT_IMAGES_BUCKET.length + 2));
  }

  if (decodedWhole.startsWith(`${PRODUCT_IMAGES_BUCKET}/`)) {
    return normalizeStorageObjectPath(decodedWhole.slice(PRODUCT_IMAGES_BUCKET.length + 1));
  }

  // 상대경로(예: "171111-abc.jpg")
  if (!decodedWhole.startsWith("/") && !decodedWhole.includes("://")) {
    return normalizeStorageObjectPath(decodedWhole);
  }
  return null;
}

export type ProductImageOrphanCleanupResult = {
  bucket: string;
  referencedCount: number;
  /** 버킷 내 삭제 가능한 이미지 확장자 파일 수(.emptyFolderPlaceholder·비이미지 제외) */
  storageFileCount: number;
  orphanCount: number;
  orphanPaths: string[];
  deletedCount: number;
  deletedPaths: string[];
  failedPaths: Array<{ path: string; message: string }>;
  parseFailures: Array<{ imageUrl: string; reason: string }>;
};

const DELETABLE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "tif", "tiff"]);
const RESET_IMAGE_MATCH_EXTENSION_PRIORITY = ["jpg", "jpeg", "png", "webp"] as const;

export function isDeletableImageObjectPath(path: string): boolean {
  const p = String(path ?? "").trim();
  if (!p) return false;
  const base = p.split("/").pop() ?? p;
  if (!base || base.startsWith(".")) return false; // .emptyFolderPlaceholder 등 보존
  const m = /\.([a-zA-Z0-9]+)$/.exec(base);
  if (!m?.[1]) return false;
  return DELETABLE_IMAGE_EXTENSIONS.has(m[1].toLowerCase());
}

export async function listAllProductImagesObjectPaths(): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [""];
  while (queue.length > 0) {
    const prefix = queue.shift() ?? "";
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const { data, error } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`[storage.list] ${error.message}`);

      const rows = data ?? [];
      for (const entry of rows) {
        const name = String(entry.name ?? "").trim();
        if (!name) continue;
        const fullPath = prefix ? `${prefix}/${name}` : name;
        // Supabase list: 폴더는 id가 없고 image/* mime_type도 없음
        const isFolder = !entry.id && !entry.metadata?.mimetype;
        if (isFolder) {
          queue.push(fullPath);
          continue;
        }
        if (isProductImagesEmptyFolderPlaceholderPath(fullPath)) continue;
        out.push(fullPath);
      }

      if (rows.length < pageSize) break;
      offset += rows.length;
    }
  }
  return out;
}

function publicUrlForProductImagesPath(path: string): string {
  const { data } = supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function splitImageObjectPath(path: string): { stem: string; ext: string; fileNameLower: string } | null {
  const base = (path.split("/").pop() ?? "").trim();
  if (!base || base.startsWith(".")) return null;
  const m = /^(.+)\.([a-zA-Z0-9]+)$/.exec(base);
  if (!m) return null;
  const stem = m[1]!.trim();
  const ext = m[2]!.toLowerCase();
  if (!stem || !DELETABLE_IMAGE_EXTENSIONS.has(ext)) return null;
  return { stem, ext, fileNameLower: `${stem}.${ext}`.toLowerCase() };
}

export type ResetSkuImageReconnectResult = {
  bucket: string;
  productsChecked: number;
  matchedCount: number;
  updatedCount: number;
  skippedNonMatchedCount: number;
  skippedExistingImageCount: number;
  failedCount: number;
  matchedSamples: Array<{ sku: string; path: string }>;
  failedSamples: Array<{ productId: string; sku: string; message: string }>;
};

/**
 * Reset 후 보정용:
 * products.sku를 normalizeSkuForMatch로 맞춰 product-images 파일명 stem과 매칭해 image_url 재연결.
 * 기본은 image_url이 비어 있는 상품만 갱신.
 */
export async function reconnectProductsImageUrlsFromStorageBySku(options?: {
  onlyIfImageUrlEmpty?: boolean;
}): Promise<ResetSkuImageReconnectResult> {
  const onlyIfImageUrlEmpty = options?.onlyIfImageUrlEmpty !== false;
  const result: ResetSkuImageReconnectResult = {
    bucket: PRODUCT_IMAGES_BUCKET,
    productsChecked: 0,
    matchedCount: 0,
    updatedCount: 0,
    skippedNonMatchedCount: 0,
    skippedExistingImageCount: 0,
    failedCount: 0,
    matchedSamples: [],
    failedSamples: [],
  };

  const storagePaths = await listAllProductImagesObjectPaths();
  storagePaths.sort((a, b) => a.localeCompare(b, "ko"));
  const byFileNameLower = new Map<string, string>();
  for (const p of storagePaths) {
    const info = splitImageObjectPath(p);
    if (!info) continue;
    // 같은 파일명이 여러 경로에 있으면 정렬상 앞선(안정적인) 경로를 사용
    if (!byFileNameLower.has(info.fileNameLower)) {
      byFileNameLower.set(info.fileNameLower, p);
    }
  }

  const { data: rows, error } = await supabaseServer
    .from("products")
    .select("id, sku, image_url")
    .order("id", { ascending: true });
  if (error) throw new Error(`[products 조회 실패] ${error.message}`);

  for (const row of rows ?? []) {
    const productId = String((row as { id?: string }).id ?? "").trim();
    const sku = String((row as { sku?: string }).sku ?? "");
    const currentUrl = String((row as { image_url?: string | null }).image_url ?? "").trim();
    if (!productId) continue;
    result.productsChecked++;

    if (onlyIfImageUrlEmpty && currentUrl !== "") {
      result.skippedExistingImageCount++;
      continue;
    }

    const skuTrim = sku.trim();
    if (!skuTrim) {
      result.skippedNonMatchedCount++;
      continue;
    }

    let hitPath: string | null = null;
    for (const ext of RESET_IMAGE_MATCH_EXTENSION_PRIORITY) {
      const wanted = `${skuTrim}.${ext}`.toLowerCase();
      const found = byFileNameLower.get(wanted);
      if (found) {
        hitPath = found;
        break;
      }
    }
    if (!hitPath) {
      result.skippedNonMatchedCount++;
      continue;
    }

    result.matchedCount++;
    if (result.matchedSamples.length < 20) {
      result.matchedSamples.push({ sku, path: hitPath });
    }

    const url = publicUrlForProductImagesPath(hitPath);
    try {
      const { error: upErr } = await supabaseServer.from("products").update({ image_url: url }).eq("id", productId);
      if (upErr) throw new Error(upErr.message);
      result.updatedCount++;
    } catch (e) {
      result.failedCount++;
      if (result.failedSamples.length < 20) {
        result.failedSamples.push({
          productId,
          sku,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return result;
}

async function removeStoragePaths(paths: string[]): Promise<{
  deletedPaths: string[];
  failedPaths: Array<{ path: string; message: string }>;
}> {
  const deletedPaths: string[] = [];
  const failedPaths: Array<{ path: string; message: string }> = [];
  const chunkSize = 100;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const { error } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).remove(chunk);
    if (error) {
      for (const p of chunk) {
        failedPaths.push({ path: p, message: error.message });
      }
      continue;
    }
    deletedPaths.push(...chunk);
  }
  return { deletedPaths, failedPaths };
}

/**
 * products.image_url 참조 집합과 Storage 이미지 파일 집합을 비교해 orphan 후보를 계산/삭제.
 * - `.emptyFolderPlaceholder` 및 비이미지 객체는 목록·개수·비교에서 제외
 * - 기본 dry-run
 * - dryRun=false + confirm=true 일 때만 실제 삭제
 * - parse 실패한 image_url은 삭제 계산에서 제외하고 `parseFailures`로 반환
 */
export async function cleanupProductImageOrphans(options?: {
  dryRun?: boolean;
  confirm?: boolean;
}): Promise<ProductImageOrphanCleanupResult> {
  const dryRun = options?.dryRun !== false;
  const confirm = options?.confirm === true;

  const { data: rows, error: pe } = await supabaseServer
    .from("products")
    .select("id, image_url")
    .not("image_url", "is", null);
  if (pe) throw new Error(`[products.image_url 조회 실패] ${pe.message}`);

  const parseFailures: Array<{ imageUrl: string; reason: string }> = [];
  const referenced = new Set<string>();
  for (const row of rows ?? []) {
    const raw = String((row as { image_url?: string | null }).image_url ?? "").trim();
    if (!raw) continue;
    const p = extractProductImagesObjectPathFromAnyRef(raw);
    if (!p) {
      parseFailures.push({
        imageUrl: raw,
        reason: "product-images 경로로 해석 불가(외부 URL/다른 버킷/비정상 형식 포함)",
      });
      continue;
    }
    referenced.add(p);
  }

  const storagePaths = await listAllProductImagesObjectPaths();
  const imageStoragePaths = storagePaths.filter((p) => isDeletableImageObjectPath(p));
  const orphanPaths = imageStoragePaths
    .filter((p) => !referenced.has(p))
    .sort((a, b) => a.localeCompare(b, "ko"));

  let deletedPaths: string[] = [];
  let failedPaths: Array<{ path: string; message: string }> = [];

  const canDelete = !dryRun && confirm;
  // 안전장치: 참조 경로 파싱 실패가 있으면 실제 삭제를 막음
  if (canDelete && parseFailures.length === 0 && orphanPaths.length > 0) {
    const rm = await removeStoragePaths(orphanPaths);
    deletedPaths = rm.deletedPaths;
    failedPaths = rm.failedPaths;
  } else if (canDelete && parseFailures.length > 0) {
    failedPaths.push({
      path: "*",
      message: `참조 image_url 파싱 실패 ${parseFailures.length}건이 있어 삭제를 중단했습니다.`,
    });
  }

  return {
    bucket: PRODUCT_IMAGES_BUCKET,
    referencedCount: referenced.size,
    storageFileCount: imageStoragePaths.length,
    orphanCount: orphanPaths.length,
    orphanPaths,
    deletedCount: deletedPaths.length,
    deletedPaths,
    failedPaths,
    parseFailures,
  };
}

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
  const objectPath = extractProductImagesObjectPathFromAnyRef(prev);
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
 * 향후 확장: orphan 스캔 결과에 `created_at`/최근 접근일 기반 보수적 보관 기간을 더해
 * "N일 이상 미참조" 정책 배치로 확장 가능.
 */
