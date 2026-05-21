/**
 * 상품·DB·Storage·로컬 이미지 개수 비교
 * npx tsx scripts/audit-product-image-counts.mts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const p = join(projectRoot, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadEnvFiles();

const {
  listAllProductImagesObjectPaths,
  isProductImagesRootSkuObjectPath,
  isDeletableImageObjectPath,
  extractProductImagesObjectPathFromAnyRef,
  stemFromProductImagesFilename,
} = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");
const { normalizeSkuForMatch } = await import("../src/app/products/skuNormalize.ts");
const { getLocalImageHrefBySkuLower } = await import("../src/app/products/localProductImages.server.ts");

async function main() {
  const { data: products, error } = await supabaseServer
    .from("products")
    .select("id, sku, image_url, thumbnail_url");
  if (error) throw error;

  const rows = products ?? [];
  const paths = await listAllProductImagesObjectPaths();
  const imagePaths = paths.filter((p) => isDeletableImageObjectPath(p));
  const rootPaths = imagePaths.filter((p) => isProductImagesRootSkuObjectPath(p));
  const thumbPaths = imagePaths.filter((p) => p.startsWith("thumbs/"));
  const otherPaths = imagePaths.filter(
    (p) => !isProductImagesRootSkuObjectPath(p) && !p.startsWith("thumbs/")
  );

  let withImageUrl = 0;
  let withThumbUrl = 0;
  let withEither = 0;
  let imageUrlProductImages = 0;
  let imageUrlExternal = 0;
  let imageUrlEmpty = 0;

  const rootStems = new Set(
    rootPaths.map((p) => stemFromProductImagesFilename(p)).filter(Boolean) as string[]
  );
  const localMap = getLocalImageHrefBySkuLower();
  const localKeys = Object.keys(localMap);

  let cardWouldTryDb = 0;
  let cardWouldTryLocal = 0;
  let cardNoCandidate = 0;
  let skuMatchesRootFile = 0;

  for (const row of rows) {
    const sku = String(row.sku ?? "").trim();
    const norm = normalizeSkuForMatch(sku);
    const iu = String(row.image_url ?? "").trim();
    const tu = String(row.thumbnail_url ?? "").trim();

    if (iu) withImageUrl++;
    if (tu) withThumbUrl++;
    if (iu || tu) withEither++;

    if (!iu) imageUrlEmpty++;
    else if (extractProductImagesObjectPathFromAnyRef(iu)) imageUrlProductImages++;
    else imageUrlExternal++;

    if (iu) cardWouldTryDb++;
    else if (norm && localMap[norm]) cardWouldTryLocal++;
    else cardNoCandidate++;

    if (norm && rootStems.has(norm)) skuMatchesRootFile++;
  }

  console.info("=== 상품·이미지 개수 감사 ===\n");
  console.info("products 총:", rows.length);
  console.info("  image_url 있음:", withImageUrl);
  console.info("  thumbnail_url 있음:", withThumbUrl);
  console.info("  둘 중 하나 이상:", withEither);
  console.info("  image_url 비어 있음:", imageUrlEmpty);
  console.info("  image_url → product-images 경로:", imageUrlProductImages);
  console.info("  image_url → 외부/기타 URL:", imageUrlExternal);
  console.info("");
  console.info("Storage product-images (이미지 확장자만):", imagePaths.length);
  console.info("  루트 {SKU}.ext (원본):", rootPaths.length);
  console.info("  thumbs/:", thumbPaths.length);
  console.info("  그 외 경로:", otherPaths.length);
  if (otherPaths.length > 0 && otherPaths.length <= 20) {
    for (const p of otherPaths) console.info("   ", p);
  }
  console.info("");
  console.info("public/images 로컬 파일(상품용 맵):", localKeys.length);
  console.info("");
  console.info("카드 표시 후보 (앱 로직 기준):");
  console.info("  DB image_url 우선:", cardWouldTryDb);
  console.info("  로컬 /images/ 폴백:", cardWouldTryLocal);
  console.info("  후보 없음(placeholder):", cardNoCandidate);
  console.info("");
  console.info("SKU 정규화 ↔ Storage 루트 파일 stem 일치:", skuMatchesRootFile);
  console.info("  (image_url 없어도 스토리지에만 있으면 카드엔 안 보임)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
