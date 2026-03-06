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
