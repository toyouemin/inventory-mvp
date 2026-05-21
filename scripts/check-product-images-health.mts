/**
 * 상품 이미지·Storage·DB 오류 점검
 * npx tsx scripts/check-product-images-health.mts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const {
  listAllProductImagesObjectPaths,
  isProductImagesRootSkuObjectPath,
  isDeletableImageObjectPath,
  extractProductImagesObjectPathFromAnyRef,
  stemFromProductImagesFilename,
  thumbnailObjectPathFromStem,
} = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");
const { normalizeSkuForMatch } = await import("../src/app/products/skuNormalize.ts");

type Issue = { code: string; message: string; detail?: string };

async function storageObjectExists(path: string): Promise<boolean> {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const { data, error } = await supabaseServer.storage.from("product-images").list(folder, {
    limit: 1000,
    search: name,
  });
  if (error) return false;
  return (data ?? []).some((e) => String(e.name) === name);
}

async function headOk(url: string): Promise<{ ok: boolean; status?: number }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ac.signal, cache: "no-store" });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const issues: Issue[] = [];
  const { data: products, error: pe } = await supabaseServer
    .from("products")
    .select("id, sku, image_url, thumbnail_url");
  if (pe) throw pe;

  const rows = products ?? [];
  const allPaths = (await listAllProductImagesObjectPaths()).filter((p) => isDeletableImageObjectPath(p));
  const rootPaths = allPaths.filter((p) => isProductImagesRootSkuObjectPath(p));
  const thumbPaths = allPaths.filter((p) => p.startsWith("thumbs/"));

  const rootByStem = new Map<string, string>();
  const thumbByStem = new Map<string, string>();
  for (const p of rootPaths) {
    const stem = stemFromProductImagesFilename(p);
    if (stem) rootByStem.set(normalizeSkuForMatch(stem), p);
  }
  for (const p of thumbPaths) {
    const stem = stemFromProductImagesFilename(p);
    if (stem) thumbByStem.set(normalizeSkuForMatch(stem), p);
  }

  const productStemSet = new Set<string>();
  const dbRootPaths = new Set<string>();

  for (const row of rows) {
    const id = String(row.id ?? "");
    const sku = String(row.sku ?? "").trim();
    const norm = normalizeSkuForMatch(sku);
    if (norm) productStemSet.add(norm);

    const iu = String(row.image_url ?? "").trim();
    const tu = String(row.thumbnail_url ?? "").trim();

    if (!iu) {
      issues.push({ code: "NO_IMAGE_URL", message: "image_url 비어 있음", detail: `sku=${sku} id=${id}` });
      continue;
    }

    const iPath = extractProductImagesObjectPathFromAnyRef(iu);
    if (!iPath) {
      issues.push({
        code: "IMAGE_URL_NOT_STORAGE",
        message: "image_url이 product-images 경로가 아님",
        detail: `sku=${sku} url=${iu.slice(0, 120)}`,
      });
      continue;
    }
    dbRootPaths.add(iPath.toLowerCase());

    if (iPath.startsWith("thumbs/")) {
      issues.push({
        code: "IMAGE_URL_IS_THUMB",
        message: "image_url이 thumbs/를 가리킴 (원본 루트 권장)",
        detail: `sku=${sku} path=${iPath}`,
      });
    } else if (!isProductImagesRootSkuObjectPath(iPath)) {
      issues.push({
        code: "IMAGE_URL_NOT_ROOT",
        message: "image_url이 루트 원본이 아님",
        detail: `sku=${sku} path=${iPath}`,
      });
    }

    const urlStem = stemFromProductImagesFilename(iPath);
    const urlNorm = urlStem ? normalizeSkuForMatch(urlStem) : "";
    if (urlNorm && norm && urlNorm !== norm) {
      issues.push({
        code: "SKU_STEM_MISMATCH",
        message: "SKU와 image_url 파일명 stem 불일치",
        detail: `sku=${sku} norm=${norm} fileStem=${urlNorm} path=${iPath}`,
      });
    }

    if (norm && !rootByStem.has(norm)) {
      issues.push({
        code: "DB_URL_NO_ROOT_FILE",
        message: "DB image_url 있으나 Storage 루트에 해당 파일 없음",
        detail: `sku=${sku} path=${iPath}`,
      });
    }

    if (!tu) {
      issues.push({ code: "NO_THUMBNAIL_URL", message: "thumbnail_url 비어 있음", detail: `sku=${sku}` });
    } else {
      const tPath = extractProductImagesObjectPathFromAnyRef(tu);
      if (!tPath?.startsWith("thumbs/")) {
        issues.push({
          code: "THUMB_URL_NOT_THUMBS",
          message: "thumbnail_url이 thumbs/가 아님",
          detail: `sku=${sku} path=${tPath ?? tu.slice(0, 80)}`,
        });
      } else if (norm) {
        const expected = thumbnailObjectPathFromStem(normalizeSkuForMatch(sku) || urlStem || "");
        if (tPath !== expected && urlStem) {
          const exp2 = thumbnailObjectPathFromStem(urlNorm);
          if (tPath !== exp2) {
            issues.push({
              code: "THUMB_PATH_UNEXPECTED",
              message: "thumbnail_url 경로가 기대 stem과 다름",
              detail: `sku=${sku} got=${tPath} expected≈${expected}`,
            });
          }
        }
        if (!thumbByStem.has(urlNorm || norm)) {
          issues.push({
            code: "THUMB_URL_NO_FILE",
            message: "thumbnail_url 있으나 Storage thumbs/ 파일 없음",
            detail: `sku=${sku} path=${tPath}`,
          });
        }
      }
    }
  }

  for (const [stem, path] of rootByStem) {
    if (!productStemSet.has(stem)) {
      issues.push({
        code: "ORPHAN_ROOT_FILE",
        message: "Storage 루트 파일인데 상품 SKU와 매칭 안 됨",
        detail: path,
      });
    }
  }

  const duplicateRootStems: string[] = [];
  const seenRoot = new Map<string, string>();
  for (const p of rootPaths) {
    const stem = stemFromProductImagesFilename(p);
    if (!stem) continue;
    const k = normalizeSkuForMatch(stem);
    const prev = seenRoot.get(k);
    if (prev && prev !== p) duplicateRootStems.push(`${k}: ${prev} + ${p}`);
    else seenRoot.set(k, p);
  }
  for (const d of duplicateRootStems) {
    issues.push({ code: "DUPLICATE_ROOT_STEM", message: "같은 stem 루트 파일 중복", detail: d });
  }

  console.info("=== 상품 이미지 오류 점검 ===\n");
  console.info("상품:", rows.length);
  console.info("Storage 루트:", rootPaths.length, "| thumbs:", thumbPaths.length);

  const sampleHead = rows.slice(0, 5);
  let headFail = 0;
  for (const row of sampleHead) {
    const url = String(row.image_url ?? "").trim();
    if (!url) continue;
    const r = await headOk(url);
    if (!r.ok) {
      headFail++;
      issues.push({
        code: "HEAD_FAIL_SAMPLE",
        message: "image_url HEAD 실패(샘플)",
        detail: `sku=${row.sku} status=${r.status ?? "err"}`,
      });
    }
  }
  console.info("image_url HEAD 샘플(5건):", headFail > 0 ? `실패 ${headFail}` : "OK");

  const byCode = new Map<string, Issue[]>();
  for (const i of issues) {
    const arr = byCode.get(i.code) ?? [];
    arr.push(i);
    byCode.set(i.code, arr);
  }

  if (issues.length === 0) {
    console.info("\n✓ 자동 점검에서 발견된 문제 없음");
  } else {
    console.info("\n발견:", issues.length, "건\n");
    for (const [code, list] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.info(`[${code}] ${list.length}건`);
      for (const item of list.slice(0, 8)) {
        console.info(`  - ${item.message}${item.detail ? ` | ${item.detail}` : ""}`);
      }
      if (list.length > 8) console.info(`  ... 외 ${list.length - 8}건`);
    }
  }

  const outDir = join(projectRoot, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "product-images-health-report.txt");
  const lines = [
    `# product-images health ${new Date().toISOString()}`,
    `products=${rows.length} root=${rootPaths.length} thumbs=${thumbPaths.length}`,
    `issues=${issues.length}`,
    "",
    ...issues.map((i) => `${i.code}\t${i.message}\t${i.detail ?? ""}`),
  ];
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.info("\n전체 리포트:", reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
