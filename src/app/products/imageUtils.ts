import { filterFailedProductImageCandidates } from "./imageLoadFailureCache";

/**
 * 상품 표시용 이미지 URL 후보 (순서대로 시도).
 * 1) image_url이 비어 있지 않으면 그 값만
 * 2) SKU가 있으면 /images/{SKU}.jpg (public 정적 파일)
 */
export function buildProductImageCandidates(sku: string, imageUrl: string | null | undefined): string[] {
  const out: string[] = [];
  const u = (imageUrl ?? "").trim();
  if (u) out.push(u);
  const s = (sku ?? "").trim();
  if (s) {
    const path = `/images/${encodeURIComponent(s)}.jpg`;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** 첫 번째 후보만 필요할 때(비권장: UI는 useProductImageSrc 사용) */
export function productDisplayImageSrc(sku: string, imageUrl: string | null | undefined): string {
  const c = filterFailedProductImageCandidates(buildProductImageCandidates(sku, imageUrl));
  return c[0] ?? "";
}

const MAX_SIZE_PX = 1200;
const JPEG_QUALITY = 0.82;

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("파일 읽기 실패"));
    r.readAsDataURL(file);
  });
}

/** Resize image to max 1200px and compress. Returns new File for upload. */
export function resizeAndCompressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w <= MAX_SIZE_PX && h <= MAX_SIZE_PX) {
        resolve(file);
        return;
      }
      if (w > h) {
        h = Math.round((h * MAX_SIZE_PX) / w);
        w = MAX_SIZE_PX;
      } else {
        w = Math.round((w * MAX_SIZE_PX) / h);
        h = MAX_SIZE_PX;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, type === "image/jpeg" ? ".jpg" : ".png");
          resolve(new File([blob], name, { type }));
        },
        type,
        type === "image/jpeg" ? JPEG_QUALITY : 0.92
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}
