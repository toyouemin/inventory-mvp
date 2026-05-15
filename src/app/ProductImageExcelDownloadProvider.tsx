"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";

type ProductImageExcelDownloadContextValue = {
  stockLoading: boolean;
  priceLoading: boolean;
  downloadStockWithImages: () => Promise<void>;
  downloadPriceWithImages: () => Promise<void>;
};

const ProductImageExcelDownloadContext = createContext<ProductImageExcelDownloadContextValue | null>(null);

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

type DownloadProgress = {
  /** null: 서버 응답 대기 또는 총량 미상 — 불확정 바 */
  pct: number | null;
  received: number;
  total: number | null;
};

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function throttleProgress(cb: () => void, minMs = 90): () => void {
  let last = 0;
  let pending = false;
  return () => {
    const now = Date.now();
    if (now - last >= minMs) {
      last = now;
      cb();
      return;
    }
    if (pending) return;
    pending = true;
    const wait = minMs - (now - last);
    window.setTimeout(() => {
      pending = false;
      last = Date.now();
      cb();
    }, Math.max(0, wait));
  };
}

async function fetchAndSaveXlsx(
  url: string,
  filename: string,
  signal: AbortSignal,
  onProgress: ((p: DownloadProgress) => void) | undefined
): Promise<void> {
  let receivedAcc = 0;
  let totalAcc: number | null = null;
  let pctAcc: number | null = null;

  const snapshot = (): DownloadProgress => ({
    pct: pctAcc,
    received: receivedAcc,
    total: totalAcc,
  });

  const throttled =
    onProgress != null
      ? throttleProgress(() => {
          onProgress(snapshot());
        })
      : null;

  const res = await fetch(url, { method: "GET", cache: "no-store", signal });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `보내기 실패 (${res.status})`);
  }

  const rawLen = res.headers.get("content-length");
  const parsedTotal =
    rawLen != null && rawLen.trim() !== "" ? Number(rawLen) : Number.NaN;
  totalAcc = Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.trunc(parsedTotal) : null;

  const mime =
    res.headers.get("content-type") ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  /** 헤더 수신 직후(본문 대기): 예상 용량을 UI에 반영 */
  receivedAcc = 0;
  pctAcc = null;
  onProgress?.(snapshot());

  function saveBlob(blob: Blob): void {
    receivedAcc = blob.size;
    if (totalAcc != null && totalAcc > 0) {
      pctAcc = 100;
    } else {
      pctAcc = 100;
    }
    onProgress?.(snapshot());
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  const body = res.body;
  if (!body?.getReader) {
    const blob = await res.blob();
    saveBlob(blob);
    return;
  }

  const reader = body.getReader();
  const chunks: BlobPart[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        receivedAcc += value.byteLength;
        if (totalAcc != null && totalAcc > 0) {
          pctAcc = Math.min(99, Math.round((receivedAcc / totalAcc) * 100));
        } else {
          pctAcc = null;
        }
        throttled?.();
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 이미 해제된 경우 무시 */
    }
  }

  saveBlob(new Blob(chunks, { type: mime }));
}

export function ProductImageExcelDownloadProvider({ children }: { children: ReactNode }) {
  const stockBusyRef = useRef(false);
  const priceBusyRef = useRef(false);
  const stockAbortRef = useRef<AbortController | null>(null);
  const priceAbortRef = useRef<AbortController | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [stockProgress, setStockProgress] = useState<DownloadProgress | null>(null);
  const [priceProgress, setPriceProgress] = useState<DownloadProgress | null>(null);
  const stockStartedAtRef = useRef<number | null>(null);
  const priceStartedAtRef = useRef<number | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);

  const cancelStock = useCallback(() => {
    const ac = stockAbortRef.current;
    if (!ac) return;
    ac.abort();
    stockAbortRef.current = null;
    stockBusyRef.current = false;
    setStockLoading(false);
    setStockProgress(null);
    stockStartedAtRef.current = null;
  }, []);

  const cancelPrice = useCallback(() => {
    const ac = priceAbortRef.current;
    if (!ac) return;
    ac.abort();
    priceAbortRef.current = null;
    priceBusyRef.current = false;
    setPriceLoading(false);
    setPriceProgress(null);
    priceStartedAtRef.current = null;
  }, []);

  const busy = stockLoading || priceLoading;
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setElapsedTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [busy]);

  const runStock = useCallback(async () => {
    if (stockBusyRef.current) return;
    stockBusyRef.current = true;
    setStockLoading(true);
    stockStartedAtRef.current = Date.now();
    setStockProgress({ pct: null, received: 0, total: null });
    const ac = new AbortController();
    stockAbortRef.current = ac;
    const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
    try {
      await fetchAndSaveXlsx(
        "/products/xlsx/products/with-images",
        `products_with_images_${yymmdd}.xlsx`,
        ac.signal,
        setStockProgress
      );
    } catch (e) {
      if (isAbortError(e)) return;
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      if (stockAbortRef.current === ac) {
        stockAbortRef.current = null;
        stockBusyRef.current = false;
        setStockLoading(false);
        setStockProgress(null);
        stockStartedAtRef.current = null;
      }
    }
  }, []);

  const runPrice = useCallback(async () => {
    if (priceBusyRef.current) return;
    priceBusyRef.current = true;
    setPriceLoading(true);
    priceStartedAtRef.current = Date.now();
    setPriceProgress({ pct: null, received: 0, total: null });
    const ac = new AbortController();
    priceAbortRef.current = ac;
    const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
    try {
      await fetchAndSaveXlsx(
        "/products/xlsx/price-list/with-images",
        `price-list_with_images_${yymmdd}.xlsx`,
        ac.signal,
        setPriceProgress
      );
    } catch (e) {
      if (isAbortError(e)) return;
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      if (priceAbortRef.current === ac) {
        priceAbortRef.current = null;
        priceBusyRef.current = false;
        setPriceLoading(false);
        setPriceProgress(null);
        priceStartedAtRef.current = null;
      }
    }
  }, []);

  const value = useMemo<ProductImageExcelDownloadContextValue>(
    () => ({
      stockLoading,
      priceLoading,
      downloadStockWithImages: runStock,
      downloadPriceWithImages: runPrice,
    }),
    [stockLoading, priceLoading, runStock, runPrice]
  );

  void elapsedTick;

  function progressMeta(
    startedAt: number | null,
    p: DownloadProgress | null,
    waitingLabel: string
  ): string {
    const elapsed = startedAt != null ? formatElapsed(Date.now() - startedAt) : "0:00";
    if (!p) {
      return `경과 ${elapsed} · ${waitingLabel}`;
    }
    if (p.received === 0) {
      if (p.total != null && p.total > 0) {
        return `경과 ${elapsed} · 예상 약 ${formatBytes(p.total)} · ${waitingLabel}`;
      }
      return `경과 ${elapsed} · ${waitingLabel}`;
    }
    if (p.total != null && p.total > 0) {
      const pct = p.pct != null ? `${p.pct}%` : "";
      return `경과 ${elapsed} · ${formatBytes(p.received)} / ${formatBytes(p.total)}${pct ? ` (${pct})` : ""}`;
    }
    return `경과 ${elapsed} · ${formatBytes(p.received)} 받는 중…`;
  }

  return (
    <ProductImageExcelDownloadContext.Provider value={value}>
      {children}
      {busy ? (
        <div className="product-image-excel-download-toast" role="status" aria-live="polite">
          <div className="product-image-excel-download-toast__rows">
            {stockLoading ? (
              <div className="product-image-excel-download-toast__row">
                <div className="product-image-excel-download-toast__main">
                  <span className="product-image-excel-download-toast__title">이미지 포함 재고 엑셀</span>
                  <span className="product-image-excel-download-toast__meta">
                    {progressMeta(
                      stockStartedAtRef.current,
                      stockProgress,
                      "서버에서 파일을 만드는 중…"
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="product-image-excel-download-toast__cancel"
                  onClick={cancelStock}
                >
                  취소
                </button>
              </div>
            ) : null}
            {priceLoading ? (
              <div className="product-image-excel-download-toast__row">
                <div className="product-image-excel-download-toast__main">
                  <span className="product-image-excel-download-toast__title">이미지 포함 가격 엑셀</span>
                  <span className="product-image-excel-download-toast__meta">
                    {progressMeta(
                      priceStartedAtRef.current,
                      priceProgress,
                      "서버에서 파일을 만드는 중…"
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="product-image-excel-download-toast__cancel"
                  onClick={cancelPrice}
                >
                  취소
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </ProductImageExcelDownloadContext.Provider>
  );
}

export function useProductImageExcelDownload(): ProductImageExcelDownloadContextValue {
  const v = useContext(ProductImageExcelDownloadContext);
  if (!v) {
    throw new Error("useProductImageExcelDownload는 ProductImageExcelDownloadProvider 안에서만 사용하세요.");
  }
  return v;
}
