const SMALL_UNITS = ["", "십", "백", "천"] as const;
const LARGE_UNITS = ["", "만", "억", "조", "경"] as const;
const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"] as const;

function chunkToKorean(chunk: number): string {
  if (chunk <= 0) return "";
  const padded = String(chunk).padStart(4, "0");
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    const d = Number(padded[i]);
    if (d === 0) continue;
    const unit = SMALL_UNITS[3 - i];
    if (d === 1 && unit !== "") {
      out += unit;
    } else {
      out += `${DIGITS[d]}${unit}`;
    }
  }
  return out;
}

export function amountToKoreanText(amount: number | null | undefined): string {
  const value = Math.round(Number(amount ?? 0));
  if (!Number.isFinite(value) || value <= 0) return "영원 정";

  let n = value;
  let unitIdx = 0;
  const parts: string[] = [];

  while (n > 0 && unitIdx < LARGE_UNITS.length) {
    const chunk = n % 10000;
    if (chunk > 0) {
      parts.unshift(`${chunkToKorean(chunk)}${LARGE_UNITS[unitIdx]}`);
    }
    n = Math.floor(n / 10000);
    unitIdx += 1;
  }

  return `${parts.join("")}원 정`;
}
