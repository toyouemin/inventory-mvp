/**
 * Storage에서 SKU/파일명 stem 검색
 * npx tsx scripts/find-storage-image.mts tmb-114bl
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const query = (process.argv[2] ?? "").trim().toLowerCase();

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

const { listAllProductImagesObjectPaths } = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");
const { normalizeSkuForMatch } = await import("../src/app/products/skuNormalize.ts");

async function main() {
  if (!query) {
    console.error("사용: npx tsx scripts/find-storage-image.mts <sku-or-stem>");
    process.exit(1);
  }

  const norm = normalizeSkuForMatch(query);
  const paths = await listAllProductImagesObjectPaths();
  const hits = paths.filter((p) => p.toLowerCase().includes(query) || p.toLowerCase().includes(norm));

  console.info("query:", query, "normalized:", norm);
  console.info("storage hits:", hits.length);
  for (const p of hits.sort()) console.info(" ", p);

  const { data: products } = await supabaseServer
    .from("products")
    .select("id, sku, image_url, thumbnail_url")
    .or(`sku.ilike.%${query}%,sku.ilike.%${norm}%`);

  console.info("\nDB products:", (products ?? []).length);
  for (const row of products ?? []) {
    console.info(JSON.stringify(row));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
