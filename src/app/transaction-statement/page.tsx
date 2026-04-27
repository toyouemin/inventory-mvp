"use client";

import html2canvas from "html2canvas";
import { useMemo, useRef, useState } from "react";
import { amountToKoreanText } from "@/features/transactionStatement/amountToKoreanText";
import { EstimateSheet } from "@/features/transactionStatement/EstimateSheet";
import { exportEstimateExcel } from "@/features/transactionStatement/exportEstimateExcel";
import {
  TransactionStatementPrintSheet,
  type TransactionStatementPrintFooter,
} from "@/features/transactionStatement/TransactionStatementPrintSheet";
import panelStyles from "@/features/transactionStatement/TransactionStatementScreenPanel.module.css";
import { TransactionStatementScreenPanel } from "@/features/transactionStatement/TransactionStatementScreenPanel";

type StatementItemFormRow = {
  id: string;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  unitPrice: string;
  note: string;
  isExtra: boolean;
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
  estimateEventName: string;
  estimateManagerName: string;
  estimateManagerPhone: string;
  estimateTotalNote: string;
  estimateFooterMemo: string;
  items: StatementItemFormRow[];
};

type DocumentType = "statement" | "estimate";

const DEFAULT_ESTIMATE_MANAGER_NAME = "김승민";
const DEFAULT_ESTIMATE_MANAGER_PHONE = "010-8521-9709";
/** 견적서 하단·견적 엑셀 입금계좌 (거래명세표 푸터 `STATEMENT_PRINT_FOOTER.bankLine`과 별도) */
const DEFAULT_ESTIMATE_BANK_ACCOUNT = "신한 140-009-456830 주식회사 세림통상";

const FIXED_SUPPLIER = {
  name: "(주)세림통상",
  bizNo: "131-86-32310",
  representative: "김영례",
  address: "인천광역시 남동구 경신상로78 (구월동)",
  businessType: "도,소매.제조업",
  businessItem: "스포츠용품",
  companyName: "(주)세림통상",
  ceoName: "김영례",
  tel: "",
  fax: "",
  managerName: DEFAULT_ESTIMATE_MANAGER_NAME,
  managerPhone: DEFAULT_ESTIMATE_MANAGER_PHONE,
  email: "",
} as const;

const TRANSACTION_STATEMENT_GUIDE_TEXT = "정보 입력→명세표 미리보기→JPG 저장→발송";
const ITEM_UNIT_OPTIONS = ["개", "장", "타", "세트"] as const;

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
    unit: "개",
    unitPrice: "",
    note: "",
    isExtra: false,
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

/** 견적서 JPG: 행사명-260424 */
function buildEstimateJpgBaseFileName(eventName: string, issueDateYmd: string): string {
  const trimmed = eventName.trim();
  const name = trimmed ? trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") : "행사미입력";
  const digits = issueDateYmd.replace(/-/g, "");
  const yyMMdd = digits.length >= 8 ? digits.slice(2, 8) : digits;
  return `${name}-${yyMMdd}`;
}

/** 숨김 캡처 호스트와 동일한 가로(860+80); 세로는 긴 품목표도 클론 단계에서 잘리지 않게 여유 */
const STATEMENT_JPG_HTML2CANVAS_VIEW = {
  scale: 3,
  windowWidth: 940,
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

function normalizePhoneInput(value: string): string {
  const digits = normalizeDigitsOnly(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function TransactionStatementPage() {
  const printCaptureRef = useRef<HTMLDivElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("statement");
  const [formData, setFormData] = useState<TransactionStatementFormData>({
    customerName: "",
    customerBizNo: "",
    customerRepresentative: "",
    customerAddress: "",
    customerBusinessType: "",
    customerBusinessItem: "",
    issueDate: formatYmd(new Date()),
    tradeDate: formatYmd(new Date()),
    estimateEventName: "",
    estimateManagerName: DEFAULT_ESTIMATE_MANAGER_NAME,
    estimateManagerPhone: DEFAULT_ESTIMATE_MANAGER_PHONE,
    estimateTotalNote: "",
    estimateFooterMemo: "",
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

  const estimateSummary = useMemo(() => {
    const estimateItems = computedRows.filter((row) => row.name.trim() !== "");
    const itemCount = estimateItems.length;
    const totalQty = estimateItems.reduce((sum, row) => sum + row.qtyNumber, 0);
    const memo = formData.estimateFooterMemo.trim();
    return {
      quoteDate: formData.issueDate,
      receiver: formData.customerName.trim() || formData.customerRepresentative.trim() || "—",
      eventName: formData.estimateEventName.trim() || "—",
      itemCount,
      totalQty,
      totalAmount: totals.totalAmount,
      vatLabel: showVatIncluded ? "VAT 포함" : "VAT 별도",
      managerName: formData.estimateManagerName.trim() || "—",
      managerPhone: formData.estimateManagerPhone.trim() || "—",
      memo: memo || "—",
    };
  }, [
    computedRows,
    formData.issueDate,
    formData.customerName,
    formData.customerRepresentative,
    formData.estimateEventName,
    formData.estimateManagerName,
    formData.estimateManagerPhone,
    formData.estimateFooterMemo,
    totals.totalAmount,
    showVatIncluded,
  ]);

  const shouldShowErrorMessage =
    !!errorMessage && !(documentType === "estimate" && errorMessage === "공급받는자 상호를 입력해 주세요.");

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

  function updateItem(id: string, key: keyof StatementItemFormRow, value: string | boolean): void {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((row) => {
        if (row.id !== id) return row;
        if (key === "isExtra") {
          return { ...row, isExtra: Boolean(value) };
        }
        if (key === "unitPrice") {
          return { ...row, unitPrice: formatThousandsWithComma(String(value)) };
        }
        if (key === "qty") {
          return { ...row, [key]: normalizeNumericInput(String(value)) };
        }
        return { ...row, [key]: String(value) };
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

    if (documentType === "estimate") {
      setDownloading(true);
      try {
        const payloadItems = computedRows
          .filter((row) => row.name.trim() !== "")
          .map((row) => ({
            id: row.id,
            category: row.spec.trim(),
            name: row.name.trim(),
            quantity: row.qtyNumber,
            unit: row.unit || "개",
            unitPrice: row.unitPriceNumber,
            isExtra: row.isExtra,
          }));

        if (!formData.customerName.trim()) {
          setErrorMessage("수신(거래처명)을 입력해 주세요.");
          return;
        }
        if (payloadItems.length === 0) {
          setErrorMessage("품목명을 1개 이상 입력해 주세요.");
          return;
        }

        const bytes = exportEstimateExcel({
          issueDate: formData.issueDate,
          receiverName: formData.customerRepresentative.trim(),
          eventName: formData.estimateEventName.trim(),
          memo: formData.estimateFooterMemo.trim(),
          vatIncluded: showVatIncluded,
          supplier: {
            businessNumber: FIXED_SUPPLIER.bizNo,
            companyName: FIXED_SUPPLIER.companyName,
            ceoName: FIXED_SUPPLIER.ceoName,
            address: FIXED_SUPPLIER.address,
            tel: FIXED_SUPPLIER.tel,
            fax: FIXED_SUPPLIER.fax,
            bankAccount: DEFAULT_ESTIMATE_BANK_ACCOUNT,
            managerName: formData.estimateManagerName.trim() || FIXED_SUPPLIER.managerName,
            managerPhone: formData.estimateManagerPhone.trim() || FIXED_SUPPLIER.managerPhone,
            email: FIXED_SUPPLIER.email,
          },
          items: payloadItems,
        });

        const blob = new Blob([new Uint8Array(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `estimate-${formData.issueDate.replace(/-/g, "").slice(2)}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "견적서 엑셀 다운로드에 실패했습니다.");
      } finally {
        setDownloading(false);
      }
      return;
    }

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
    if (documentType === "estimate") {
      if (!formData.customerRepresentative.trim()) {
        setErrorMessage("수신자를 입력해 주세요.");
        return;
      }
    } else if (!formData.customerName.trim()) {
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

      const sheetEl =
        (target.querySelector("[data-ts-print-sheet]") as HTMLElement | null) ??
        (target.querySelector("[data-estimate-print-sheet]") as HTMLElement | null);
      const titleEl = target.querySelector(".ts-print-title") as HTMLElement | null;
      const issueEl = target.querySelector(".ts-print-issue-date") as HTMLElement | null;
      if (sheetEl) {
        const hostWidthPx = Math.round(target.getBoundingClientRect().width);
        const sheetWidthPx = Math.round(sheetEl.getBoundingClientRect().width);
        const payload: Record<string, unknown> = { documentType, hostWidthPx, sheetWidthPx };
        if (titleEl && issueEl) {
          payload.titleFontSize = getComputedStyle(titleEl).fontSize;
          payload.issueDateFontSize = getComputedStyle(issueEl).fontSize;
        }
        // eslint-disable-next-line no-console -- JPG 캡처 고정 레이아웃 검증(모바일/PC 동일성)
        console.log("[Transaction JPG capture]", payload);
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
      const dataUrl = canvas.toDataURL("image/jpeg", 0.98);
      const fileName =
        documentType === "estimate"
          ? `${buildEstimateJpgBaseFileName(formData.estimateEventName, formData.issueDate)}.jpg`
          : `${buildStatementBaseFileName(formData.customerName, formData.issueDate)}.jpg`;
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
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <button
            type="button"
            className={`btn btn-compact ${documentType === "statement" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setDocumentType("statement")}
          >
            거래명세서
          </button>
          <button
            type="button"
            className={`btn btn-compact ${documentType === "estimate" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setDocumentType("estimate")}
          >
            견적서
          </button>
        </div>

        {documentType === "statement" ? (
          <>
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
          </>
        ) : (
          <div className="estimate-form">
            <div className="estimate-form__row">
              <label className="transaction-form-grid__date">
                견적일
                <input type="date" value={formData.issueDate} onChange={(event) => updateFormField("issueDate", event.target.value)} />
              </label>
            </div>

            <div className="estimate-form__row estimate-form__row--2col">
              <label className="transaction-form-grid__customer">
                수신자
                <input
                  value={formData.customerRepresentative}
                  onChange={(event) => updateFormField("customerRepresentative", event.target.value)}
                />
              </label>
              <label className="transaction-form-grid__customer">
                행사명(대회명)
                <input
                  value={formData.estimateEventName}
                  onChange={(event) => updateFormField("estimateEventName", event.target.value)}
                />
              </label>
            </div>

            <div className="estimate-form__row estimate-form__row--2col">
              <label className="transaction-form-grid__customer">
                담당자
                <input
                  value={formData.estimateManagerName}
                  onChange={(event) => updateFormField("estimateManagerName", event.target.value)}
                />
              </label>
              <label className="transaction-form-grid__customer">
                담당자 연락처
                <input
                  value={formData.estimateManagerPhone}
                  inputMode="numeric"
                  onChange={(event) => updateFormField("estimateManagerPhone", normalizePhoneInput(event.target.value))}
                />
              </label>
            </div>
          </div>
        )}

        <div className="transaction-items">
          <div className="transaction-items__header">
            <h2>품목 리스트</h2>
          </div>
          <div className="transaction-items__rows">
            {computedRows.map((row, index) => (
              <div key={row.id} className="transaction-item-row">
                <div className="transaction-item-row__grid">
                  <label className="transaction-item-row__name-field">
                    품목명
                    <input value={row.name} onChange={(event) => updateItem(row.id, "name", event.target.value)} />
                  </label>
                  <label className="transaction-item-row__category-field">
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
                  <label className="transaction-item-row__unit-field">
                    단위
                    <select value={row.unit} onChange={(event) => updateItem(row.id, "unit", event.target.value)}>
                      {ITEM_UNIT_OPTIONS.map((unitOption) => (
                        <option key={unitOption} value={unitOption}>
                          {unitOption}
                        </option>
                      ))}
                    </select>
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
                <div
                  className={`transaction-item-row__actions${
                    documentType === "estimate" ? " transaction-item-row__actions--estimate" : ""
                  }`}
                >
                  <button type="button" className="btn btn-primary btn-compact" onClick={addRow}>
                    품목 추가
                  </button>
                  {documentType === "estimate" ? (
                    <button
                      type="button"
                      className={`btn btn-compact ${row.isExtra ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => updateItem(row.id, "isExtra", !row.isExtra)}
                      aria-pressed={row.isExtra}
                    >
                      {row.isExtra ? "경품입력" : "기본입력"}
                    </button>
                  ) : null}
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
          {documentType === "estimate" ? (
            <div className="transaction-items__estimate-memo">
              <label>
                하단 공통 비고
                <textarea
                  value={formData.estimateFooterMemo}
                  onChange={(event) => updateFormField("estimateFooterMemo", event.target.value)}
                  placeholder="견적서 하단 큰 비고 박스에 표시됩니다."
                  rows={4}
                />
              </label>
            </div>
          ) : null}
        </div>

        {documentType === "statement" ? (
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
        ) : (
          <section className={panelStyles.panel}>
            <div className={panelStyles.panelHeader}>
              <h2 className={panelStyles.panelTitle}>견적서 요약</h2>
              <label className={panelStyles.vatToggle}>
                <span className={panelStyles.vatToggleLabel}>부가세 포함 표시</span>
                <input
                  type="checkbox"
                  className={panelStyles.vatToggleInput}
                  checked={showVatIncluded}
                  onChange={(event) => setShowVatIncluded(event.target.checked)}
                />
                <span className={panelStyles.vatToggleTrack} aria-hidden />
              </label>
            </div>
            <div className={panelStyles.summaryStack} role="group" aria-label="견적서 요약 정보">
              <div className={panelStyles.summaryInline}>
                <span className={panelStyles.summaryItem}>
                  <strong>견적일</strong> {estimateSummary.quoteDate || "—"}
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>수신</strong> {estimateSummary.receiver}
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>행사명</strong> {estimateSummary.eventName}
                </span>
              </div>
              <div className={panelStyles.summaryInline}>
                <span className={panelStyles.summaryItem}>
                  <strong>품목 수</strong> {estimateSummary.itemCount.toLocaleString("ko-KR")}
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>총 수량</strong> {estimateSummary.totalQty.toLocaleString("ko-KR")}
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>견적금액</strong> {estimateSummary.totalAmount.toLocaleString("ko-KR")}원
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>{estimateSummary.vatLabel}</strong>
                </span>
              </div>
              <div className={panelStyles.summaryInline}>
                <span className={panelStyles.summaryItem}>
                  <strong>담당자</strong> {estimateSummary.managerName}
                </span>
                <span className={panelStyles.summaryItem}>
                  <strong>담당자 연락처</strong> {estimateSummary.managerPhone}
                </span>
              </div>
              <div className={panelStyles.summaryInline}>
                <span className={panelStyles.summaryItem}>
                  <strong>비고</strong> {estimateSummary.memo}
                </span>
              </div>
            </div>
            <div className={panelStyles.previewRow}>
              <button
                type="button"
                className={`btn btn-secondary btn-compact ${panelStyles.previewBtn}`}
                onClick={() => previewDialogRef.current?.showModal()}
              >
                견적서 미리보기
              </button>
            </div>
          </section>
        )}

        <div ref={printCaptureRef} className="transaction-print-hidden-host" aria-hidden="true">
          {documentType === "statement" ? (
            <TransactionStatementPrintSheet {...printSheetProps} captureFixed />
          ) : (
            <EstimateSheet
              data={{
                date: formData.issueDate,
                receiverName: formData.customerRepresentative,
                eventName: formData.estimateEventName,
                memo: formData.estimateFooterMemo,
                totalNote: formData.estimateTotalNote,
              }}
              items={computedRows.map((row) => ({
                id: row.id,
                category: row.spec,
                name: row.name,
                quantity: row.qtyNumber,
                unit: row.unit || "개",
                unitPrice: row.unitPriceNumber,
                note: row.note,
                isExtra: row.isExtra,
              }))}
              supplier={{
                businessNumber: FIXED_SUPPLIER.bizNo,
                companyName: FIXED_SUPPLIER.companyName,
                ceoName: FIXED_SUPPLIER.ceoName,
                address: FIXED_SUPPLIER.address,
                tel: FIXED_SUPPLIER.tel,
                fax: FIXED_SUPPLIER.fax,
                bankAccount: DEFAULT_ESTIMATE_BANK_ACCOUNT,
                managerName: formData.estimateManagerName || FIXED_SUPPLIER.managerName,
                managerPhone: formData.estimateManagerPhone || FIXED_SUPPLIER.managerPhone,
                email: FIXED_SUPPLIER.email,
              }}
              vatIncluded={showVatIncluded}
              captureFixed
            />
          )}
        </div>

        <dialog ref={previewDialogRef} className="transaction-preview-dialog" aria-labelledby="transaction-preview-title">
          <div className="transaction-preview-dialog__toolbar">
            <h2 id="transaction-preview-title">{documentType === "statement" ? "출력명세서" : "견적서 미리보기"}</h2>
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
            {documentType === "statement" ? (
              <TransactionStatementPrintSheet {...printSheetProps} />
            ) : (
              <EstimateSheet
                data={{
                  date: formData.issueDate,
                  receiverName: formData.customerRepresentative,
                  eventName: formData.estimateEventName,
                  memo: formData.estimateFooterMemo,
                  totalNote: formData.estimateTotalNote,
                }}
                items={computedRows.map((row) => ({
                  id: row.id,
                  category: row.spec,
                  name: row.name,
                  quantity: row.qtyNumber,
                  unit: row.unit || "개",
                  unitPrice: row.unitPriceNumber,
                  note: row.note,
                  isExtra: row.isExtra,
                }))}
                supplier={{
                  businessNumber: FIXED_SUPPLIER.bizNo,
                  companyName: FIXED_SUPPLIER.companyName,
                  ceoName: FIXED_SUPPLIER.ceoName,
                  address: FIXED_SUPPLIER.address,
                  tel: FIXED_SUPPLIER.tel,
                  fax: FIXED_SUPPLIER.fax,
                  bankAccount: DEFAULT_ESTIMATE_BANK_ACCOUNT,
                  managerName: formData.estimateManagerName || FIXED_SUPPLIER.managerName,
                  managerPhone: formData.estimateManagerPhone || FIXED_SUPPLIER.managerPhone,
                  email: FIXED_SUPPLIER.email,
                }}
                vatIncluded={showVatIncluded}
              />
            )}
          </div>
        </dialog>

        {shouldShowErrorMessage ? <p className="transaction-error">{errorMessage}</p> : null}

        <div className="transaction-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading || jpgSaving}
          >
            {downloading ? "다운로드 중..." : documentType === "statement" ? "명세표 Excel다운" : "견적서 Excel다운"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleJpgSave()}
            disabled={jpgSaving || downloading}
          >
            {jpgSaving ? "JPG 저장 중…" : documentType === "statement" ? "명세표 이미지 저장" : "견적서 이미지 저장"}
          </button>
        </div>
      </section>
    </main>
  );
}
