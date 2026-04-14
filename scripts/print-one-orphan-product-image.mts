/**
 * product-images 버킷 전체 객체 경로와 products.image_url(정규화된 object path)을 비교해,
 * DB 어떤 행의 image_url에도 등장하지 않는 스토리지 파일 1개 경로를 콘솔에 출력합니다.
 *
 * 사용: npx tsx scripts/print-one-orphan-product-image.mts
 * 루트에 .env.local 또는 .env (NEXT_PUBLIC_SUPABASE_URL, 키 등)가 있어야 합니다.
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
  extractProductImagesObjectPathFromAnyRef,
  isDeletableImageObjectPath,
  listAllProductImagesObjectPaths,
} = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");

const { data: rows, error } = await supabaseServer.from("products").select("image_url");
if (error) {
  console.error("[products 조회 실패]", error.message);
  process.exit(1);
}

const referenced = new Set<string>();
for (const row of rows ?? []) {
  const raw = String((row as { image_url?: string | null }).image_url ?? "").trim();
  if (!raw) continue;
  const p = extractProductImagesObjectPathFromAnyRef(raw);
  if (p) referenced.add(p);
}

const storagePaths = await listAllProductImagesObjectPaths();
const notInDb = storagePaths.filter((p) => !referenced.has(p)).sort((a, b) => a.localeCompare(b, "ko"));
const notInDbImage = notInDb.filter((p) => isDeletableImageObjectPath(p));
const chosen = notInDbImage[0] ?? notInDb[0];

if (!chosen) {
  console.log("(DB 미참조 스토리지 파일 없음)");
  process.exit(0);
}

console.log(chosen);
