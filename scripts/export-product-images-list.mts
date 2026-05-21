/**
 * product-images 버킷 전체(또는 루트만) 파일 목록을 텍스트/CSV로 저장
 *
 *   npx tsx scripts/export-product-images-list.mts
 *   npx tsx scripts/export-product-images-list.mts --root-only
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const rootOnly = process.argv.includes("--root-only");

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
} = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");

async function listRootOnly(): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const { data, error } = await supabaseServer.storage.from("product-images").list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const rows = data ?? [];
    for (const entry of rows) {
      const name = String(entry.name ?? "").trim();
      if (!name) continue;
      const isFolder = !entry.id && !entry.metadata?.mimetype;
      if (isFolder) continue;
      if (isDeletableImageObjectPath(name) && isProductImagesRootSkuObjectPath(name)) {
        out.push(name);
      }
    }
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return out.sort((a, b) => a.localeCompare(b, "ko"));
}

async function main() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "(미설정)";
  const paths = rootOnly
    ? await listRootOnly()
    : (await listAllProductImagesObjectPaths())
        .filter((p) => isDeletableImageObjectPath(p))
        .sort((a, b) => a.localeCompare(b, "ko"));

  const outDir = join(projectRoot, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = rootOnly ? `product-images-root-${stamp}` : `product-images-all-${stamp}`;
  const txtPath = join(outDir, `${base}.txt`);
  const csvPath = join(outDir, `${base}.csv`);

  const lines = [
    `# product-images ${rootOnly ? "루트만" : "전체(재귀)"}`,
    `# Supabase: ${supaUrl}`,
    `# 생성: ${new Date().toISOString()}`,
    `# 개수: ${paths.length}`,
    "",
    ...paths,
  ];
  writeFileSync(txtPath, lines.join("\n"), "utf8");

  const csvLines = ["path", ...paths.map((p) => `"${p.replace(/"/g, '""')}"`)];
  writeFileSync(csvPath, "\uFEFF" + csvLines.join("\n"), "utf8");

  const rootCount = paths.filter((p) => isProductImagesRootSkuObjectPath(p)).length;
  const thumbsCount = paths.filter((p) => p.startsWith("thumbs/")).length;

  console.info("Supabase URL:", supaUrl);
  console.info("저장 완료:", paths.length, "개");
  console.info("  ", txtPath);
  console.info("  ", csvPath);
  if (!rootOnly) {
    console.info("  루트 원본:", rootCount, "| thumbs/:", thumbsCount);
  }
  if (paths.length > 0) {
    console.info("  첫 파일:", paths[0]);
    console.info("  마지막:", paths[paths.length - 1]);
  }
  console.info("\n대시보드는 폴더당 약 100~200개만 보여 주는 경우가 많습니다.");
  console.info("전체 목록은 위 txt/csv를 Excel·메모장으로 여세요.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
