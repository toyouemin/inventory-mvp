/** 긴 변 기준(초과 시 비율 유지 축소). 이미 이하면 해상도는 유지할 수 있음 */
const MAX_SIZE_PX = 600;
/** 600px급 리스트/카드용 — 0.75~0.80 범위에서 용량·화질 균형 */
const JPEG_QUALITY = 0.78;
/** 투명 유지; 사진형 PNG도 어느 정도만 줄임(무손실 아님). 더 작게 하면 텍스트·로고가 거칠어질 수 있음 */
const PNG_QUALITY = 0.88;
/**
 * 해상도는 이미 충분한데 원본만 큰 경우(고압축 PNG·메타데이터 등) 재인코딩해 업로드·전송 부담 감소.
 * 이 크기 이하면 그대로 통과(불필요한 재압축 방지).
 */
const SOFT_REENCODE_MAX_BYTES = 380 * 1024;

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("파일 읽기 실패"));
    r.readAsDataURL(file);
  });
}

function targetDimensions(naturalW: number, naturalH: number): { w: number; h: number } {
  let w = naturalW;
  let h = naturalH;
  if (w <= MAX_SIZE_PX && h <= MAX_SIZE_PX) {
    return { w, h };
  }
  if (w > h) {
    h = Math.round((h * MAX_SIZE_PX) / w);
    w = MAX_SIZE_PX;
  } else {
    w = Math.round((w * MAX_SIZE_PX) / h);
    h = MAX_SIZE_PX;
  }
  return { w, h };
}

/** 긴 변 최대 600px + (선택) 과대 용량 시 동일 해상도 재인코딩. Returns new File for upload. */
export function resizeAndCompressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const { w: tw, h: th } = targetDimensions(nw, nh);
      const needsResize = nw !== tw || nh !== th;
      const needsReencode = file.size > SOFT_REENCODE_MAX_BYTES;
      if (!needsResize && !needsReencode) {
        resolve(file);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, tw, th);
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
        type === "image/jpeg" ? JPEG_QUALITY : PNG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}
