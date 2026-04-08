import { createClient } from "@supabase/supabase-js";

type VariantRow = {
  sku: string | null;
  color: string | null;
  gender: string | null;
  size: string | null;
};

function norm(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function genderRank(g: string): number {
  if (g.startsWith("여")) return 1;
  if (g.startsWith("남")) return 2;
  return 3;
}

function sizeNum(size: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(size) ?? /(\d+(?:\.\d+)?)/.exec(size);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function oldDisplayCompare(a: { gender: string; size: string }, b: { gender: string; size: string }): number {
  const an = sizeNum(a.size);
  const bn = sizeNum(b.size);
  if (an != null && bn != null && an !== bn) return an - bn;
  if (an != null && bn == null) return -1;
  if (an == null && bn != null) return 1;
  const gs = `${a.gender}${a.size}`.localeCompare(`${b.gender}${b.size}`, "ko", { numeric: true });
  if (gs !== 0) return gs;
  return a.gender.localeCompare(b.gender, "ko");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("필수 환경변수 누락: NEXT_PUBLIC_SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("product_variants")
    .select("sku, color, gender, size");

  if (error) {
    console.error("조회 실패:", error.message);
    process.exit(1);
  }

  const rows = ((data ?? []) as VariantRow[]).map((r) => ({
    sku: norm(r.sku),
    color: norm(r.color),
    gender: norm(r.gender),
    size: norm(r.size),
  }));

  const bySkuColor = new Map<string, Array<{ sku: string; color: string; gender: string; size: string }>>();
  for (const r of rows) {
    if (!r.sku) continue;
    const key2 = `${r.sku}\0${r.color}`;
    const arr = bySkuColor.get(key2) ?? [];
    arr.push(r);
    bySkuColor.set(key2, arr);
  }

  const mixed: Array<{ sku: string; color: string; oldOrder: string[]; fixedOrder: string[] }> = [];
  for (const [key2, arr] of bySkuColor) {
    const female = arr.filter((x) => x.gender.startsWith("여"));
    const male = arr.filter((x) => x.gender.startsWith("남"));
    if (female.length === 0 || male.length === 0) continue;

    const oldSorted = [...arr].sort(oldDisplayCompare);
    const fixedSorted = [...arr].sort((a, b) => {
      const gr = genderRank(a.gender) - genderRank(b.gender);
      if (gr !== 0) return gr;
      const an = sizeNum(a.size);
      const bn = sizeNum(b.size);
      if (an != null && bn != null && an !== bn) return an - bn;
      return a.size.localeCompare(b.size, "ko", { numeric: true });
    });

    const oldOrder = oldSorted.map((x) => `${x.gender}${x.size}`);
    const fixedOrder = fixedSorted.map((x) => `${x.gender}${x.size}`);
    if (oldOrder.join("|") !== fixedOrder.join("|")) {
      const [sku, color] = key2.split("\0");
      mixed.push({ sku, color, oldOrder, fixedOrder });
    }
  }

  mixed.sort((a, b) => a.sku.localeCompare(b.sku, "ko") || a.color.localeCompare(b.color, "ko"));
  console.log(`총 점검 행: ${rows.length}`);
  console.log(`정렬 차이 SKU/컬러 그룹: ${mixed.length}`);
  for (const m of mixed.slice(0, 200)) {
    console.log(`- ${m.sku} [${m.color || "-"}]`);
    console.log(`  old:   ${m.oldOrder.join(" ")}`);
    console.log(`  fixed: ${m.fixedOrder.join(" ")}`);
  }
}

void main();
