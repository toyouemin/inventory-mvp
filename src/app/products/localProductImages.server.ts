import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * public/images 안 실제 파일만 반영.
 * 키: SKU stem trim + toLowerCase (대소문자 무시 매칭)
 * 값: 브라우저 요청용 경로 (/images/실제파일명, 파일명만 encodeURIComponent)
 */
export function getLocalImageHrefBySkuLower(): Record<string, string> {
  const dir = path.join(process.cwd(), "public", "images");
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return out;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!IMAGE_EXT.test(name)) continue;
    const stem = name.replace(IMAGE_EXT, "");
    const key = stem.trim().toLowerCase();
    if (!key || out[key] != null) continue;
    out[key] = `/images/${encodeURIComponent(name)}`;
  }
  return out;
}
