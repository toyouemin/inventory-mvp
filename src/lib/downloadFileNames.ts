import { formatDownloadFileNameDateYymmdd } from "./downloadFileNameDate";

/** 다운로드 표시명(한글) + ASCII fallback(구형 Content-Disposition) */
export type NamedDownloadFile = {
  display: string;
  ascii: string;
};

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeDownloadFileName(name: string): string {
  const trimmed = String(name ?? "").trim();
  const cleaned = trimmed.replace(INVALID_FILENAME_CHARS, "_");
  return cleaned.length > 0 ? cleaned : "download";
}

/** RFC 5987 `filename*` (UTF-8 percent-encoding) */
export function encodeContentDispositionFilenameStar(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (ch) =>
    `%${ch.codePointAt(0)!.toString(16).toUpperCase()}`
  );
}

export function buildAttachmentContentDisposition(file: NamedDownloadFile): string {
  const display = sanitizeDownloadFileName(file.display);
  const ascii =
    sanitizeDownloadFileName(file.ascii).replace(/[^\x20-\x7E]/g, "_") || "download";
  const star = encodeContentDispositionFilenameStar(display);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

function datedFile(baseKo: string, baseAscii: string, ext: string, date = new Date()): NamedDownloadFile {
  const yymmdd = formatDownloadFileNameDateYymmdd(date);
  return {
    display: `${baseKo}_${yymmdd}.${ext}`,
    ascii: `${baseAscii}_${yymmdd}.${ext}`,
  };
}

export function productStockCsvFile(date?: Date): NamedDownloadFile {
  return datedFile("상품재고", "products", "csv", date);
}

export function productStockXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("상품재고", "products", "xlsx", date);
}

export function stockCsvFile(date?: Date): NamedDownloadFile {
  return datedFile("재고", "stock", "csv", date);
}

export function stockXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("재고", "stock", "xlsx", date);
}

export function priceListXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("가격표", "price-list", "xlsx", date);
}

export function productStockWithImagesXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("상품재고_이미지포함", "products_with_images", "xlsx", date);
}

export function priceListWithImagesXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("가격표_이미지포함", "price-list_with_images", "xlsx", date);
}

export function transactionStatementXlsxFile(date?: Date): NamedDownloadFile {
  return datedFile("거래명세표", "transaction-statement", "xlsx", date);
}
