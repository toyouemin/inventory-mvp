"use client";

import {
  createContext,
  useCallback,
  useContext,
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

async function fetchAndSaveXlsx(url: string, filename: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "GET", cache: "no-store", signal });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `보내기 실패 (${res.status})`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function ProductImageExcelDownloadProvider({ children }: { children: ReactNode }) {
  const stockBusyRef = useRef(false);
  const priceBusyRef = useRef(false);
  const stockAbortRef = useRef<AbortController | null>(null);
  const priceAbortRef = useRef<AbortController | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);

  const cancelStock = useCallback(() => {
    const ac = stockAbortRef.current;
    if (!ac) return;
    ac.abort();
    stockAbortRef.current = null;
    stockBusyRef.current = false;
    setStockLoading(false);
  }, []);

  const cancelPrice = useCallback(() => {
    const ac = priceAbortRef.current;
    if (!ac) return;
    ac.abort();
    priceAbortRef.current = null;
    priceBusyRef.current = false;
    setPriceLoading(false);
  }, []);

  const runStock = useCallback(async () => {
    if (stockBusyRef.current) return;
    stockBusyRef.current = true;
    setStockLoading(true);
    const ac = new AbortController();
    stockAbortRef.current = ac;
    const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
    try {
      await fetchAndSaveXlsx("/products/xlsx/products/with-images", `products_with_images_${yymmdd}.xlsx`, ac.signal);
    } catch (e) {
      if (isAbortError(e)) return;
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      if (stockAbortRef.current === ac) {
        stockAbortRef.current = null;
        stockBusyRef.current = false;
        setStockLoading(false);
      }
    }
  }, []);

  const runPrice = useCallback(async () => {
    if (priceBusyRef.current) return;
    priceBusyRef.current = true;
    setPriceLoading(true);
    const ac = new AbortController();
    priceAbortRef.current = ac;
    const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
    try {
      await fetchAndSaveXlsx("/products/xlsx/price-list/with-images", `price-list_with_images_${yymmdd}.xlsx`, ac.signal);
    } catch (e) {
      if (isAbortError(e)) return;
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      if (priceAbortRef.current === ac) {
        priceAbortRef.current = null;
        priceBusyRef.current = false;
        setPriceLoading(false);
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

  const busy = stockLoading || priceLoading;

  return (
    <ProductImageExcelDownloadContext.Provider value={value}>
      {children}
      {busy ? (
        <div className="product-image-excel-download-toast" role="status" aria-live="polite">
          <div className="product-image-excel-download-toast__rows">
            {stockLoading ? (
              <div className="product-image-excel-download-toast__row">
                <span className="product-image-excel-download-toast__label">이미지 포함 재고 엑셀 생성 중…</span>
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
                <span className="product-image-excel-download-toast__label">이미지 포함 가격 엑셀 생성 중…</span>
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
