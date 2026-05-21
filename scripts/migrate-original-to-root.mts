/**
 * `product-images/original/{file}` → 버킷 루트 `{file}` 로 복사(이동 옵션).
 *
 * 사용:
 *   npx tsx scripts/migrate-original-to-root.mts              # dry-run (기본)
 *   npx tsx scripts/migrate-original-to-root.mts --execute      # 실제 복사
 *   npx tsx scripts/migrate-original-to-root.mts --execute --delete-original  # 복사 후 original/ 삭제
 *   npx tsx scripts/migrate-original-to-root.mts --execute --overwrite      # 루트에 이미 있으면 덮어쓰기
 *
 * 필요: .env.local — NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(권장)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const execute = process.argv.includes("--execute");
const deleteOriginal = process.argv.includes("--delete-original");
const overwrite = process.argv.includes("--overwrite");

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
  PRODUCT_IMAGES_BUCKET,
  listAllProductImagesObjectPaths,
  isDeletableImageObjectPath,
} = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");

type Row = { from: string; to: string; action: "copy" | "skip_exists" | "skip_non_image" };

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    console.error("NEXT_PUBLIC_SUPABASE_URL 이 없습니다.");
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.warn(
      "[경고] SUPABASE_SERVICE_ROLE_KEY 없음 — anon 키로 시도합니다. Storage 권한 오류가 나면 service role을 넣어 주세요."
    );
  }

  const all = await listAllProductImagesObjectPaths();
  const fromOriginal = all
    .filter((p) => p.startsWith("original/"))
    .filter((p) => isDeletableImageObjectPath(p))
    .sort((a, b) => a.localeCompare(b, "ko"));

  const rows: Row[] = [];
  const rootNames = new Set(
    all.filter((p) => !p.includes("/") && isDeletableImageObjectPath(p)).map((p) => p.toLowerCase())
  );

  for (const from of fromOriginal) {
    const base = from.slice("original/".length);
    if (!base || base.includes("/")) continue;
    const to = base;
    if (!isDeletableImageObjectPath(to)) {
      rows.push({ from, to, action: "skip_non_image" });
      continue;
    }
    if (rootNames.has(to.toLowerCase()) && !overwrite) {
      rows.push({ from, to, action: "skip_exists" });
      continue;
    }
    rows.push({ from, to, action: "copy" });
  }

  const toCopy = rows.filter((r) => r.action === "copy");
  const skipped = rows.filter((r) => r.action !== "copy");

  console.info(
    JSON.stringify(
      {
        mode: execute ? "execute" : "dry-run",
        bucket: PRODUCT_IMAGES_BUCKET,
        originalImageCount: fromOriginal.length,
        willCopy: toCopy.length,
        skippedExists: skipped.filter((r) => r.action === "skip_exists").length,
        deleteOriginalAfter: execute && deleteOriginal,
        overwrite,
        samples: toCopy.slice(0, 15).map((r) => ({ from: r.from, to: r.to })),
      },
      null,
      2
    )
  );

  if (!execute) {
    console.info("\n실제 복사: npx tsx scripts/migrate-original-to-root.mts --execute");
    console.info("복사 후 original 삭제: ... --execute --delete-original");
    return;
  }

  let copied = 0;
  let failed = 0;
  const copiedFrom: string[] = [];

  for (const { from, to } of toCopy) {
    const { error: copyErr } = await supabaseServer.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .copy(from, to);
    if (copyErr) {
      console.error("[copy 실패]", { from, to, message: copyErr.message });
      failed++;
      continue;
    }
    copied++;
    copiedFrom.push(from);
    if (copied % 50 === 0) console.info(`... ${copied}건 복사됨`);
  }

  let deleted = 0;
  if (deleteOriginal && copiedFrom.length > 0) {
    for (let i = 0; i < copiedFrom.length; i += 100) {
      const chunk = copiedFrom.slice(i, i + 100);
      const { error: rmErr } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).remove(chunk);
      if (rmErr) {
        console.error("[original 삭제 실패]", { chunk: chunk.length, message: rmErr.message });
      } else {
        deleted += chunk.length;
      }
    }
  }

  console.info(
    JSON.stringify({ copied, failed, deletedOriginalObjects: deleted, skippedExists: skipped.filter((r) => r.action === "skip_exists").length }, null, 2)
  );
  console.info(
    "\n다음: products.image_url 을 루트 공개 URL로 맞추기(CSV 초기화+재연결 또는 별도 DB 스크립트). 코드도 루트 {SKU} 업로드로 맞추세요."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
