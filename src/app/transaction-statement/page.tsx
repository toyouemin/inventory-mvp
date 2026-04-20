"use client";

import html2canvas from "html2canvas";
import { useMemo, useRef, useState } from "react";
import { amountToKoreanText } from "@/features/transactionStatement/amountToKoreanText";
import {
  TransactionStatementPrintSheet,
  type TransactionStatementPrintFooter,
} from "@/features/transactionStatement/TransactionStatementPrintSheet";
import { TransactionStatementScreenPanel } from "@/features/transactionStatement/TransactionStatementScreenPanel";

type StatementItemFormRow = {
  id: string;
  name: string;
  spec: string;
  qty: string;
  unitPrice: string;
  note: string;
};

type TransactionStatementFormData = {
  customerName: string;
  customerBizNo: string;
  customerRepresentative: string;
  customerAddress: string;
  customerBusinessType: string;
  customerBusinessItem: string;
  issueDate: string;
  tradeDate: string;
  items: StatementItemFormRow[];
};

const FIXED_SUPPLIER = {
  name: "(주)세림통상",
  bizNo: "131-86-32310",
  representative: "김영례",
  address: "인천광역시 남동구 경신상로78 (구월동)",
  businessType: "도,소매.제조업",
  businessItem: "스포츠용품",
} as const;

const TRANSACTION_STATEMENT_GUIDE_TEXT = "정보 입력→명세표 미리보기→JPG 저장→발송";

/** 출력 푸터(은행·URL 등은 사업 정보에 맞게 수정) */
const STATEMENT_PRINT_FOOTER: TransactionStatementPrintFooter = {
  legalLeftLines: [
    "본 거래명세표는 거래 내역 확인용이며, 세금계산서와 별개로 발행될 수 있습니다.",
    "부가가치세법에 따른 세금계산서는 별도로 수취해 주시기 바랍니다.",
  ],
  rightLogoText: "TAGO",
  bankLine: "신한은행 100-030-255130  주식회사 세림통상",
  website: "www.tagosports.co.kr",
};

function makeRow(idSuffix: number): StatementItemFormRow {
  return {
    id: `row-${idSuffix}`,
    name: "",
    spec: "",
    qty: "",
    unitPrice: "",
    note: "",
  };
}

function toNumber(value: string): number {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function calculateAmount(qtyValue: string, unitPriceValue: string): number {
  return toNumber(qtyValue) * toNumber(unitPriceValue);
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sanitizeFileNamePart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "상호미입력";
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

/** 형식: 상호-거래명세표-260417 */
function buildStatementBaseFileName(customerName: string, issueDateYmd: string): string {
  const name = sanitizeFileNamePart(customerName);
  const digits = issueDateYmd.replace(/-/g, "");
  const yyMMdd = digits.length >= 8 ? digits.slice(2, 8) : digits;
  return `${name}-거래명세표-${yyMMdd}`;
}

/** 숨김 캡처 호스트 가로(2300)와 동일; 세로는 긴 품목표도 클론 단계에서 잘리지 않게 여유 */
const STATEMENT_JPG_HTML2CANVAS_VIEW = {
  scale: 3,
  windowWidth: 2300,
  windowHeight: 6000,
  scrollX: 0,
  scrollY: 0,
} as const;

async function waitForFontsAndNextPaint(): Promise<void> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 로컬 폰트 로드 실패 시에도 캡처는 진행 */
    }
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function normalizeDigitsOnly(value: string): string {
  const normalized = value
    // 전각 숫자(０-９)를 반각 숫자(0-9)로 변환
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/,/g, "");
  return normalized.replace(/\D/g, "");
}

function normalizeNumericInput(value: string): string {
  return normalizeDigitsOnly(value);
}

function formatThousandsWithComma(value: string): string {
  const digits = normalizeDigitsOnly(value);
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeBizNoInput(value: string): string {
  const digits = normalizeDigitsOnly(value).slice(0, 11);

  // 11자리면 휴대폰 번호 형식(XXX-XXXX-XXXX) 우선 적용
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  // 그 외(최대 10자리)는 사업자번호 형식(XXX-XX-XXXXX)
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

export default function TransactionStatementPage() {
  const printCaptureRef = useRef<HTMLDivElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const [formData, setFormData] = useState<TransactionStatementFormData>({
    customerName: "",
    customerBizNo: "",
    customerRepresentative: "",
    customerAddress: "",
    customerBusinessType: "",
    customerBusinessItem: "",
    issueDate: formatYmd(new Date()),
    tradeDate: formatYmd(new Date()),
    items: [makeRow(1)],
  });
  const [downloading, setDownloading] = useState(false);
  const [jpgSaving, setJpgSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  /** 거래 요약 토글과 동일: 끄면 미리보기·JPG에도 부가세 관련 문구·공급/세액 숨김 */
  const [showVatIncluded, setShowVatIncluded] = useState(true);

  const computedRows = useMemo(
    () =>
      formData.items.map((row) => {
        const qty = toNumber(row.qty);
        const unitPrice = toNumber(row.unitPrice);
        const amount = calculateAmount(row.qty, row.unitPrice);
        return { ...row, qtyNumber: qty, unitPriceNumber: unitPrice, amount };
      }),
    [formData.items]
  );

  const totals = useMemo(
    () => ({
      totalQty: computedRows.reduce((sum, row) => sum + row.qtyNumber, 0),
      totalAmount: computedRows.reduce((sum, row) => sum + row.amount, 0),
    }),
    [computedRows]
  );

  const settlement = useMemo(() => {
    const supplyAmount = Math.round(totals.totalAmount / 1.1);
    const taxAmount = totals.totalAmount - supplyAmount;
    return {
      supplyAmount,
      taxAmount,
      amountKoreanText: amountToKoreanText(totals.totalAmount),
    };
  }, [totals.totalAmount]);

  const printLines = useMemo(
    () =>
      computedRows
        .map((row) => ({
          id: row.id,
          name: row.name,
          spec: row.spec,
          qty: row.qtyNumber,
          unitPrice: row.unitPriceNumber,
          amount: row.amount,
          note: row.note,
        })),
    [computedRows]
  );

  const screenLines = useMemo(
    () =>
      printLines.map((row) => ({
        id: row.id,
        name: row.name,
        spec: row.spec,
        qty: row.qty,
        amount: row.amount,
      })),
    [printLines]
  );

  const printSheetProps = useMemo(
    () => ({
      supplier: {
        name: FIXED_SUPPLIER.name,
        bizNo: FIXED_SUPPLIER.bizNo,
        representative: FIXED_SUPPLIER.representative,
        address: FIXED_SUPPLIER.address,
        businessType: FIXED_SUPPLIER.businessType,
        businessItem: FIXED_SUPPLIER.businessItem,
      },
      customer: {
        name: formData.customerName,
        bizNo: formData.customerBizNo,
        representative: formData.customerRepresentative,
        address: formData.customerAddress,
        businessType: formData.customerBusinessType,
        businessItem: formData.customerBusinessItem,
      },
      issueDate: formData.issueDate,
      tradeDate: formData.tradeDate || formData.issueDate,
      lines: printLines,
      totalQty: totals.totalQty,
      supplyAmount: settlement.supplyAmount,
      taxAmount: settlement.taxAmount,
      totalAmount: totals.totalAmount,
      totalAmountKorean: settlement.amountKoreanText,
      printFooter: STATEMENT_PRINT_FOOTER,
      showVatIncluded,
    }),
    [
      formData.customerName,
      formData.customerBizNo,
      formData.customerRepresentative,
      formData.customerAddress,
      formData.customerBusinessType,
      formData.customerBusinessItem,
      formData.issueDate,
      formData.tradeDate,
      printLines,
      totals.totalQty,
      settlement.supplyAmount,
      settlement.taxAmount,
      settlement.amountKoreanText,
      totals.totalAmount,
      showVatIncluded,
    ]
  );

  function updateItem(id: string, key: keyof StatementItemFormRow, value: string): void {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((row) => {
        if (row.id !== id) return row;
        if (key === "unitPrice") {
          return { ...row, unitPrice: formatThousandsWithComma(value) };
        }
        if (key === "qty") {
          return { ...row, [key]: normalizeNumericInput(value) };
        }
        return { ...row, [key]: value };
      }),
    }));
  }

  function updateFormField<K extends Exclude<keyof TransactionStatementFormData, "items">>(
    key: K,
    value: TransactionStatementFormData[K]
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function addRow(): void {
    setFormData((prev) => ({ ...prev, items: [...prev.items, makeRow(Date.now())] }));
  }

  function removeRow(id: string): void {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.length <= 1 ? prev.items : prev.items.filter((row) => row.id !== id),
    }));
  }

  async function handleDownload(): Promise<void> {
    if (downloading) return;
    setErrorMessage("");

    const tradeDateForItems = formData.tradeDate || formData.issueDate;
    const [tradeYear, tradeMonthRaw, tradeDayRaw] = tradeDateForItems.split("-");
    const tradeMonth = Number(tradeMonthRaw) || null;
    const tradeDay = Number(tradeDayRaw) || null;
    const payloadItems = computedRows
      .filter((row) => row.name.trim() !== "")
      .map((row) => ({
        month: tradeYear ? tradeMonth : null,
        day: tradeYear ? tradeDay : null,
        name: row.name.trim(),
        spec: row.spec.trim(),
        qty: row.qtyNumber,
        unitPrice: row.unitPriceNumber,
        amount: row.amount,
        note: row.note.trim(),
      }));

    if (!formData.customerName.trim()) {
      setErrorMessage("공급받는자 상호를 입력해 주세요.");
      return;
    }
    if (payloadItems.length === 0) {
      setErrorMessage("품목명을 1개 이상 입력해 주세요.");
      return;
    }

    setDownloading(true);
    try {
      const response = await fetch("/api/documents/transaction-statement/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statement: {
            supplier: {
              name: FIXED_SUPPLIER.name,
              bizNo: FIXED_SUPPLIER.bizNo,
              representative: FIXED_SUPPLIER.representative,
              address: FIXED_SUPPLIER.address,
              businessType: FIXED_SUPPLIER.businessType,
              businessItem: FIXED_SUPPLIER.businessItem,
            },
            customer: {
              name: formData.customerName.trim(),
              bizNo: formData.customerBizNo.trim(),
              representative: formData.customerRepresentative.trim(),
              address: formData.customerAddress.trim(),
              businessType: formData.customerBusinessType.trim(),
              businessItem: formData.customerBusinessItem.trim(),
            },
            issueDate: formData.issueDate,
            items: payloadItems,
            totalQty: payloadItems.reduce((sum: number, row: { qty: number }) => sum + row.qty, 0),
            totalAmount: payloadItems.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0),
            footerMemo: "",
            showVatIncluded,
          },
        }),
      });

      if (!response.ok) {
        const message = (await response.text()) || "거래명세표 엑셀 다운로드에 실패했습니다.";
        throw new Error(message);
      }

      const blob = await response.blob();
      const fallback = `${buildStatementBaseFileName(formData.customerName, formData.issueDate)}.xlsx`;
      const filename = fallback;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "거래명세표 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleJpgSave(): Promise<void> {
    if (jpgSaving || downloading) return;
    setErrorMessage("");

    const itemCount = computedRows.filter((row) => row.name.trim() !== "").length;
    if (!formData.customerName.trim()) {
      setErrorMessage("공급받는자 상호를 입력해 주세요.");
      return;
    }
    if (itemCount === 0) {
      setErrorMessage("품목명을 1개 이상 입력해 주세요.");
      return;
    }

    const target = printCaptureRef.current;
    if (!target) {
      setErrorMessage("출력 캡처 영역을 찾을 수 없습니다.");
      return;
    }

    setJpgSaving(true);
    try {
      await waitForFontsAndNextPaint();

      const sheetEl = target.querySelector("[data-ts-print-sheet]") as HTMLElement | null;
      const titleEl = target.querySelector(".ts-print-title") as HTMLElement | null;
      const issueEl = target.querySelector(".ts-print-issue-date") as HTMLElement | null;
      if (sheetEl && titleEl && issueEl) {
        const hostWidthPx = Math.round(target.getBoundingClientRect().width);
        const sheetWidthPx = Math.round(sheetEl.getBoundingClientRect().width);
        const titleFontSize = getComputedStyle(titleEl).fontSize;
        const issueDateFontSize = getComputedStyle(issueEl).fontSize;
        // eslint-disable-next-line no-console -- JPG 캡처 고정 레이아웃 검증(모바일/PC 동일성)
        console.log("[Statement JPG capture]", {
          hostWidthPx,
          sheetWidthPx,
          titleFontSize,
          issueDateFontSize,
        });
      }

      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        scale: STATEMENT_JPG_HTML2CANVAS_VIEW.scale,
        windowWidth: STATEMENT_JPG_HTML2CANVAS_VIEW.windowWidth,
        windowHeight: STATEMENT_JPG_HTML2CANVAS_VIEW.windowHeight,
        scrollX: STATEMENT_JPG_HTML2CANVAS_VIEW.scrollX,
        scrollY: STATEMENT_JPG_HTML2CANVAS_VIEW.scrollY,
      });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      const fileName = `${buildStatementBaseFileName(formData.customerName, formData.issueDate)}.jpg`;
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "거래명세표 JPG 저장에 실패했습니다.");
    } finally {
      setJpgSaving(false);
    }
  }

  return (
    <main className="transaction-page">
      <section className="card transaction-page__card">
        <h1>거래명세표 작성</h1>
        <p className="muted transaction-page__desc">{TRANSACTION_STATEMENT_GUIDE_TEXT}</p>

        <div className="transaction-form-grid">
          <label className="transaction-form-grid__customer">
            상호/클럽
            <input value={formData.customerName} onChange={(event) => updateFormField("customerName", event.target.value)} />
          </label>
          <label className="transaction-form-grid__customer">
            사업자번호/핸드폰
            <input
              inputMode="numeric"
              value={formData.customerBizNo}
              onChange={(event) => updateFormField("customerBizNo", normalizeBizNoInput(event.target.value))}
            />
          </label>
          <label className="transaction-form-grid__customer">
            성명
            <input
              value={formData.customerRepresentative}
              onChange={(event) => updateFormField("customerRepresentative", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            업태
            <input
              value={formData.customerBusinessType}
              onChange={(event) => updateFormField("customerBusinessType", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            종목
            <input
              value={formData.customerBusinessItem}
              onChange={(event) => updateFormField("customerBusinessItem", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            사업장주소
            <input
              value={formData.customerAddress}
              onChange={(event) => updateFormField("customerAddress", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__date transaction-form-grid__date--mobile">
            발행일자
            <input type="date" value={formData.issueDate} onChange={(event) => updateFormField("issueDate", event.target.value)} />
          </label>
          <label className="transaction-form-grid__date transaction-form-grid__date--mobile">
            거래일자
            <input type="date" value={formData.tradeDate} onChange={(event) => updateFormField("tradeDate", event.target.value)} />
          </label>
        </div>

        <div className="transaction-date-row" aria-label="거래명세 날짜 입력">
          <label className="transaction-form-grid__date transaction-form-grid__date--desktop">
            발행일자
            <input type="date" value={formData.issueDate} onChange={(event) => updateFormField("issueDate", event.target.value)} />
          </label>
          <label className="transaction-form-grid__date transaction-form-grid__date--desktop">
            거래일자
            <input type="date" value={formData.tradeDate} onChange={(event) => updateFormField("tradeDate", event.target.value)} />
          </label>
        </div>

        <div className="transaction-items">
          <div className="transaction-items__header">
            <h2>품목 리스트</h2>
          </div>
          <div className="transaction-items__rows">
            {computedRows.map((row, index) => (
              <div key={row.id} className="transaction-item-row">
                <div className="transaction-item-row__grid">
                  <label>
                    품목명
                    <input value={row.name} onChange={(event) => updateItem(row.id, "name", event.target.value)} />
                  </label>
                  <label>
                    규격
                    <input value={row.spec} onChange={(event) => updateItem(row.id, "spec", event.target.value)} />
                  </label>
                  <label>
                    수량
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(event) => updateItem(row.id, "qty", event.target.value)}
                    />
                  </label>
                  <label>
                    단가
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.unitPrice}
                      onChange={(event) => updateItem(row.id, "unitPrice", event.target.value)}
                    />
                  </label>
                  <label>
                    금액(자동)
                    <input value={row.amount.toLocaleString("ko-KR")} readOnly />
                  </label>
                  <label>
                    비고
                    <input value={row.note} onChange={(event) => updateItem(row.id, "note", event.target.value)} />
                  </label>
                </div>
                <div className="transaction-item-row__actions">
                  <button type="button" className="btn btn-primary btn-compact" onClick={addRow}>
                    품목 추가
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-compact"
                    onClick={() => removeRow(row.id)}
                    disabled={formData.items.length <= 1}
                  >
                    {index + 1}행 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <TransactionStatementScreenPanel
          issueDate={formData.issueDate}
          tradeDateYmd={formData.tradeDate || formData.issueDate}
          supplierName={FIXED_SUPPLIER.name}
          supplierBizNo={FIXED_SUPPLIER.bizNo}
          supplierRepresentative={FIXED_SUPPLIER.representative}
          customerName={formData.customerName}
          customerBizNo={formData.customerBizNo}
          customerRepresentative={formData.customerRepresentative}
          lines={screenLines}
          totalQty={totals.totalQty}
          supplyAmount={settlement.supplyAmount}
          taxAmount={settlement.taxAmount}
          totalAmount={totals.totalAmount}
          amountKoreanText={settlement.amountKoreanText}
          showVatIncluded={showVatIncluded}
          onShowVatIncludedChange={setShowVatIncluded}
          onOpenPrintPreview={() => previewDialogRef.current?.showModal()}
        />

        <div ref={printCaptureRef} className="transaction-print-hidden-host" aria-hidden="true">
          <div className="transaction-print-capture-a4-scale">
            <TransactionStatementPrintSheet {...printSheetProps} captureFixed />
          </div>
        </div>

        <dialog ref={previewDialogRef} className="transaction-preview-dialog" aria-labelledby="transaction-preview-title">
          <div className="transaction-preview-dialog__toolbar">
            <h2 id="transaction-preview-title">출력명세서</h2>
            <div className="transaction-preview-dialog__toolbarActions">
              <button
                type="button"
                className={`btn btn-compact transaction-preview-dialog__vatBtn${
                  showVatIncluded ? " transaction-preview-dialog__vatBtn--active" : ""
                }`}
                onClick={() => setShowVatIncluded((prev) => !prev)}
                disabled={jpgSaving || downloading}
                aria-pressed={showVatIncluded}
              >
                {showVatIncluded ? "VAT 포함" : "VAT 미포함"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-compact"
                onClick={() => void handleJpgSave()}
                disabled={jpgSaving || downloading}
              >
                {jpgSaving ? "JPG 저장 중…" : "JPG 저장"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => previewDialogRef.current?.close()}
              >
                닫기
              </button>
            </div>
          </div>
          <div className="transaction-preview-dialog__scroll">
            <TransactionStatementPrintSheet {...printSheetProps} />
          </div>
        </dialog>

        {errorMessage ? <p className="transaction-error">{errorMessage}</p> : null}

        <div className="transaction-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading || jpgSaving}
          >
            {downloading ? "다운로드 중..." : "명세표 Excel다운"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleJpgSave()}
            disabled={jpgSaving || downloading}
          >
            {jpgSaving ? "JPG 저장 중…" : "명세표 이미지 저장"}
          </button>
        </div>
      </section>
    </main>
  );
}
