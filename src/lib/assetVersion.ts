/**
 * PWA 아이콘·manifest 등 정적 자산 캐시 무효화용.
 * 아이콘/매니페스트를 바꾼 뒤 배포 전에 숫자만 올리거나, Vercel에 NEXT_PUBLIC_ASSET_VERSION 설정.
 */
export function getAssetVersion(): string {
  return (process.env.NEXT_PUBLIC_ASSET_VERSION ?? "1").trim() || "1";
}

export function withAssetVersion(path: string): string {
  const v = getAssetVersion();
  return path.includes("?") ? `${path}&v=${encodeURIComponent(v)}` : `${path}?v=${encodeURIComponent(v)}`;
}
