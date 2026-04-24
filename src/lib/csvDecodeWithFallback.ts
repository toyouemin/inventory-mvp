/**
 * CSV 바이트 버퍼를 디코드합니다. UTF-8을 먼저 시도하고,
 * replacement 문자(�)가 있으면 euc-kr·windows-949(CP949)로 재시도해
 * 가장 적게 깨진 결과를 선택합니다.
 */
export function decodeWithFallback(buf: ArrayBuffer): string {
  const countReplacement = (s: string) => (s.match(/\uFFFD/g) ?? []).length;

  let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  let bad = countReplacement(text);

  if (bad > 0) {
    for (const label of ["euc-kr", "windows-949"] as const) {
      try {
        const alt = new TextDecoder(label, { fatal: false }).decode(buf);
        const altBad = countReplacement(alt);
        if (altBad < bad) {
          text = alt;
          bad = altBad;
        }
      } catch {
        // 환경에 따라 레이블 미지원
      }
    }
  }

  return text.replace(/^\uFEFF/, "");
}
