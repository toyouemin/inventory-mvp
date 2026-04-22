/** 다운로드 파일명용 YYMMDD (예: 260422) */
export function formatDownloadFileNameDateYymmdd(date: Date = new Date()): string {
  const y = String(date.getFullYear()).slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
