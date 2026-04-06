import fs from "node:fs";
import path from "node:path";
import { normalizeSkuForMatch } from "./skuNormalize";

/** 동일 정규화 SKU에 파일이 여러 개일 때: jpg → jpeg → png → webp */
const EXT_RANK: Record<string, number> = {
  ".jpg": 0,
  ".jpeg": 1,
  ".png": 2,
  ".webp": 3,
};

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

function fileExtRank(filename: string): number | null {
  const m = /\.(jpg|jpeg|png|webp)$/i.exec(filename);
  if (!m) return null;
  const ext = `.${m[1]!.toLowerCase()}`;
  return EXT_RANK[ext] ?? null;
}

/**
 * `public/images` 실제 파일만 반영.
 * 키: 파일명(확장자 제외)을 `normalizeSkuForMatch` 한 값 (DB·CSV SKU와 동일 규칙)
 * 값: 브라우저 요청 경로 (`/images/` + encodeURIComponent(실제파일명))
 *
 * 동일 키로 여러 확장자가 있으면 jpg → jpeg → png → webp 우선.
 */
export function getLocalImageHrefBySkuLower(): Record<string, string> {
  const dir = path.join(process.cwd(), "public", "images");
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return out;

  /** normSku → 가장 우선인 파일 */
  const best = new Map<string, { rank: number; href: string }>();

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!IMAGE_EXT.test(name)) continue;
    const rank = fileExtRank(name);
    if (rank == null) continue;

    const stem = name.replace(IMAGE_EXT, "");
    const key = normalizeSkuForMatch(stem);
    if (!key) continue;

    const href = `/images/${encodeURIComponent(name)}`;
    const prev = best.get(key);
    if (!prev || rank < prev.rank) {
      best.set(key, { rank, href });
    }
  }

  for (const [k, v] of best) {
    out[k] = v.href;
  }
  return out;
}
