/**
 * product-images 루트만 list (재귀 없음) — 대시보드 화면과 비교
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const p = join(projectRoot, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnvFiles();

const { supabaseServer } = await import("../src/lib/supabaseClient.ts");
const {
  PRODUCT_IMAGES_BUCKET,
  isDeletableImageObjectPath,
  isProductImagesRootSkuObjectPath,
  extractProductImagesObjectPathFromAnyRef,
} = await import("../src/lib/productImagesStorage.ts");

async function listPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const { data, error } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const rows = data ?? [];
    for (const entry of rows) {
      const name = String(entry.name ?? "").trim();
      if (!name) continue;
      const fullPath = prefix ? `${prefix}/${name}` : name;
      const isFolder = !entry.id && !entry.metadata?.mimetype;
      if (isFolder) out.push(`[folder] ${fullPath}`);
      else if (isDeletableImageObjectPath(fullPath)) out.push(fullPath);
    }
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return out;
}

async function main() {
  const rootEntries = await listPrefix("");
  const rootImages = rootEntries.filter((p) => !p.startsWith("[folder]") && isProductImagesRootSkuObjectPath(p));
  const folders = rootEntries.filter((p) => p.startsWith("[folder]"));

  console.info("루트 list (재귀 없음):");
  console.info("  폴더:", folders.map((f) => f.replace("[folder] ", "")).join(", ") || "(없음)");
  console.info("  루트 이미지 파일:", rootImages.length);

  const thumbs = await listPrefix("thumbs");
  const thumbImages = thumbs.filter((p) => isDeletableImageObjectPath(p));
  console.info("  thumbs/ 이미지:", thumbImages.length);

  const { data: products } = await supabaseServer.from("products").select("id, sku, image_url");
  let urlRoot = 0;
  let urlThumbs = 0;
  let urlOther = 0;
  const rootSet = new Set(rootImages.map((p) => p.toLowerCase()));

  for (const p of products ?? []) {
    const path = extractProductImagesObjectPathFromAnyRef(String(p.image_url ?? ""));
    if (!path) {
      urlOther++;
      continue;
    }
    if (path.startsWith("thumbs/")) urlThumbs++;
    else if (isProductImagesRootSkuObjectPath(path)) urlRoot++;
    else urlOther++;
  }

  console.info("\nDB image_url 경로:");
  console.info("  루트 원본:", urlRoot);
  console.info("  thumbs:", urlThumbs);
  console.info("  기타:", urlOther);

  const missingRootFile: string[] = [];
  for (const p of products ?? []) {
    const path = extractProductImagesObjectPathFromAnyRef(String(p.image_url ?? ""));
    if (!path || !isProductImagesRootSkuObjectPath(path)) continue;
    if (!rootSet.has(path.toLowerCase())) missingRootFile.push(`${p.sku} → ${path}`);
  }
  console.info("\nDB는 루트 URL인데 Storage 루트 목록에 없음:", missingRootFile.length);
  if (missingRootFile.length > 0 && missingRootFile.length <= 50) {
    for (const s of missingRootFile) console.info(" ", s);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
