/**
 * products.stock_change_summary 문자열 형식:
 * `[남95: +2, 여90: -1]` — 표시 전용이며 같은 초( UNIX 초 ) 내 ±조정을 합산해 병합합니다.
 */

export function stockChangeEpochSec(iso: string | Date): number {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** `"[남95: +2, 여90: -1]"` 또는 `남95: +2`(괄호 없음)·빈 파싱 */
export function parseStockChangeBracket(raw: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw) return out;
  let s = String(raw).trim();
  if (!s) return out;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1).trim();
  if (!s) return out;
  const pieces = s.split(/\s*,\s*/);
  const entryRe = /^(.+?):\s*([+-]?\d+)\s*$/;
  for (const piece of pieces) {
    const p = piece.trim();
    if (!p) continue;
    const m = entryRe.exec(p);
    if (!m) continue;
    const label = m[1]!.trim();
    const v = Number(m[2]);
    if (!label) continue;
    if (!Number.isFinite(v)) continue;
    out.set(label, v);
  }
  return out;
}

export function formatStockChangeBracketFromMap(parts: Map<string, number>): string | null {
  if (parts.size === 0) return null;
  const keys = [...parts.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  const segments = keys.map((k) => {
    const v = parts.get(k) ?? 0;
    const sign = v > 0 ? `+${v}` : `${v}`;
    return `${k}: ${sign}`;
  });
  return `[${segments.join(", ")}]`;
}

export function mergeProductStockChangeSummary(args: {
  prevSummary: string | null | undefined;
  prevStockUpdatedAtIso: string | null | undefined;
  nextStockUpdatedAtIso: string;
  delta: number;
  label: string;
}): string | null {
  const { prevSummary, prevStockUpdatedAtIso, nextStockUpdatedAtIso, delta, label } = args;
  if (!label || !Number.isFinite(delta) || delta === 0) return parseOnlyOrNull(prevSummary);

  const nextSec = stockChangeEpochSec(nextStockUpdatedAtIso);
  const prevSec =
    typeof prevStockUpdatedAtIso === "string" && prevStockUpdatedAtIso.trim().length > 0
      ? stockChangeEpochSec(prevStockUpdatedAtIso)
      : NaN;

  let map =
    prevSec === nextSec && prevSummary?.trim()
      ? parseStockChangeBracket(prevSummary)
      : new Map<string, number>();

  const cur = map.get(label) ?? 0;
  const nv = cur + delta;
  if (nv === 0) map.delete(label);
  else map.set(label, nv);
  return formatStockChangeBracketFromMap(map);
}

function parseOnlyOrNull(raw: string | null | undefined): string | null {
  const m = parseStockChangeBracket(raw ?? "");
  return formatStockChangeBracketFromMap(m);
}
