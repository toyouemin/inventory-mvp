"use client";

import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { amountToKoreanText } from "@/features/transactionStatement/amountToKoreanText";

type StatementItemFormRow = {
  id: string;
  month: string;
  day: string;
  name: string;
  spec: string;
  qty: string;
  unitPrice: string;
  note: string;
};

type TransactionStatementFormData = {
  supplierName: string;
  supplierBizNo: string;
  customerName: string;
  customerBizNo: string;
  customerRepresentative: string;
  customerAddress: string;
  customerBusinessType: string;
  customerBusinessItem: string;
  issueDate: string;
  items: StatementItemFormRow[];
};

function makeRow(idSuffix: number): StatementItemFormRow {
  return {
    id: `row-${idSuffix}`,
    month: "",
    day: "",
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

function parseDownloadName(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  return contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? fallback;
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
  const statementCaptureRef = useRef<HTMLDivElement | null>(null);
  const [formData, setFormData] = useState<TransactionStatementFormData>({
    supplierName: "(주)세림통상",
    supplierBizNo: "131-86-32310",
    customerName: "",
    customerBizNo: "",
    customerRepresentative: "",
    customerAddress: "",
    customerBusinessType: "",
    customerBusinessItem: "",
    issueDate: formatYmd(new Date()),
    items: [makeRow(1)],
  });
  const [downloading, setDownloading] = useState(false);
  const [jpgDownloading, setJpgDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  function updateItem(id: string, key: keyof StatementItemFormRow, value: string): void {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((row) => {
        if (row.id !== id) return row;
        if (key === "month" || key === "day" || key === "qty" || key === "unitPrice") {
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

    const payloadItems = computedRows
      .filter((row) => row.name.trim() !== "")
      .map((row) => ({
        month: row.month.trim() === "" ? null : toNumber(row.month),
        day: row.day.trim() === "" ? null : toNumber(row.day),
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
            supplier: { name: formData.supplierName.trim(), bizNo: formData.supplierBizNo.trim() },
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
          },
        }),
      });

      if (!response.ok) {
        const message = (await response.text()) || "거래명세표 엑셀 다운로드에 실패했습니다.";
        throw new Error(message);
      }

      const blob = await response.blob();
      const fallback = `transaction-statement-${formData.issueDate.replace(/-/g, "")}.xlsx`;
      const filename = parseDownloadName(response.headers.get("content-disposition"), fallback);
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

  async function handleJpgDownload(): Promise<void> {
    if (jpgDownloading) return;
    if (!statementCaptureRef.current) {
      setErrorMessage("JPG 캡처 영역을 찾을 수 없습니다.");
      return;
    }

    setErrorMessage("");
    setJpgDownloading(true);
    try {
      const canvas = await html2canvas(statementCaptureRef.current, {
        backgroundColor: "#ffffff",
        scale: 2.5,
        useCORS: true,
      });
      const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const fileName = `transaction-statement-${formData.issueDate.replace(/-/g, "")}.jpg`;
      const anchor = document.createElement("a");
      anchor.href = jpgDataUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "거래명세표 JPG 다운로드에 실패했습니다.");
    } finally {
      setJpgDownloading(false);
    }
  }

  return (
    <main className="transaction-page">
      <section className="card transaction-page__card">
        <h1>거래명세표 작성</h1>
        <p className="muted transaction-page__desc">
          공급받는자 정보와 품목을 입력한 뒤 거래명세표 엑셀을 다운로드하세요.
        </p>

        <div className="transaction-form-grid">
          <label>
            공급자 상호
            <input value={formData.supplierName} onChange={(event) => updateFormField("supplierName", event.target.value)} />
          </label>
          <label>
            공급자 사업자번호
            <input
              inputMode="numeric"
              placeholder="예: 131-86-32310"
              value={formData.supplierBizNo}
              onChange={(event) => updateFormField("supplierBizNo", normalizeBizNoInput(event.target.value))}
            />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 상호
            <input value={formData.customerName} onChange={(event) => updateFormField("customerName", event.target.value)} />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 사업자번호
            <input
              inputMode="numeric"
              placeholder="입력"
              value={formData.customerBizNo}
              onChange={(event) => updateFormField("customerBizNo", normalizeBizNoInput(event.target.value))}
            />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 성명
            <input
              placeholder="입력"
              value={formData.customerRepresentative}
              onChange={(event) => updateFormField("customerRepresentative", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 사업장주소
            <input
              placeholder="입력"
              value={formData.customerAddress}
              onChange={(event) => updateFormField("customerAddress", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 업태
            <input
              placeholder="입력"
              value={formData.customerBusinessType}
              onChange={(event) => updateFormField("customerBusinessType", event.target.value)}
            />
          </label>
          <label className="transaction-form-grid__customer">
            공급받는자 종목
            <input
              placeholder="입력"
              value={formData.customerBusinessItem}
              onChange={(event) => updateFormField("customerBusinessItem", event.target.value)}
            />
          </label>
          <label>
            발행일자
            <input type="date" value={formData.issueDate} onChange={(event) => updateFormField("issueDate", event.target.value)} />
          </label>
        </div>

        <div className="transaction-items">
          <div className="transaction-items__header">
            <h2>품목 리스트</h2>
            <button type="button" className="btn btn-secondary btn-compact" onClick={addRow}>
              품목 추가
            </button>
          </div>
          <div className="transaction-items__rows">
            {computedRows.map((row, index) => (
              <div key={row.id} className="transaction-item-row">
                <div className="transaction-item-row__grid">
                  <label>
                    월
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.month}
                      onChange={(event) => updateItem(row.id, "month", event.target.value)}
                    />
                  </label>
                  <label>
                    일
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.day}
                      onChange={(event) => updateItem(row.id, "day", event.target.value)}
                    />
                  </label>
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
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
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

        <div className="transaction-summary">
          <div>총수량: {totals.totalQty.toLocaleString("ko-KR")}</div>
          <div>공급가액: {settlement.supplyAmount.toLocaleString("ko-KR")}원</div>
          <div>세액: {settlement.taxAmount.toLocaleString("ko-KR")}원</div>
          <div>합계금액: {totals.totalAmount.toLocaleString("ko-KR")}원</div>
          <div>합계금액(한글): {settlement.amountKoreanText}</div>
        </div>

        <div className="transaction-capture-stage">
          <div ref={statementCaptureRef} className="transaction-capture-sheet">
            <div className="transaction-capture-sheet__title">거래명세표</div>
            <div className="transaction-capture-meta">
              <section className="transaction-capture-party">
                <h3>공급자</h3>
                <div className="transaction-capture-party__grid">
                  <div>
                    <strong>상호</strong>
                    <span>{formData.supplierName || "-"}</span>
                  </div>
                  <div>
                    <strong>사업자번호</strong>
                    <span>{formData.supplierBizNo || "-"}</span>
                  </div>
                  <div>
                    <strong>성명</strong>
                    <span>-</span>
                  </div>
                  <div>
                    <strong>업태</strong>
                    <span>-</span>
                  </div>
                  <div>
                    <strong>종목</strong>
                    <span>-</span>
                  </div>
                  <div>
                    <strong>발행일자</strong>
                    <span>{formData.issueDate || "-"}</span>
                  </div>
                  <div className="transaction-capture-party__full">
                    <strong>사업장주소</strong>
                    <span>-</span>
                  </div>
                </div>
              </section>

              <section className="transaction-capture-party">
                <h3>공급받는자</h3>
                <div className="transaction-capture-party__grid">
                  <div>
                    <strong>상호</strong>
                    <span>{formData.customerName || "-"}</span>
                  </div>
                  <div>
                    <strong>사업자번호</strong>
                    <span>{formData.customerBizNo || "-"}</span>
                  </div>
                  <div>
                    <strong>성명</strong>
                    <span>{formData.customerRepresentative || "-"}</span>
                  </div>
                  <div>
                    <strong>업태</strong>
                    <span>{formData.customerBusinessType || "-"}</span>
                  </div>
                  <div>
                    <strong>종목</strong>
                    <span>{formData.customerBusinessItem || "-"}</span>
                  </div>
                  <div>
                    <strong>발행일자</strong>
                    <span>{formData.issueDate || "-"}</span>
                  </div>
                  <div className="transaction-capture-party__full">
                    <strong>사업장주소</strong>
                    <span>{formData.customerAddress || "-"}</span>
                  </div>
                </div>
              </section>
            </div>

            <table className="transaction-capture-table">
              <colgroup>
                <col className="transaction-capture-col transaction-capture-col--month" />
                <col className="transaction-capture-col transaction-capture-col--day" />
                <col className="transaction-capture-col transaction-capture-col--name" />
                <col className="transaction-capture-col transaction-capture-col--spec" />
                <col className="transaction-capture-col transaction-capture-col--qty" />
                <col className="transaction-capture-col transaction-capture-col--unit-price" />
                <col className="transaction-capture-col transaction-capture-col--amount" />
                <col className="transaction-capture-col transaction-capture-col--note" />
              </colgroup>
              <thead>
                <tr>
                  <th>월</th>
                  <th>일</th>
                  <th>품목명</th>
                  <th>규격</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>금액</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {computedRows
                  .filter((row) => row.name.trim() !== "")
                  .map((row) => (
                    <tr key={`capture-${row.id}`}>
                      <td>{row.month || ""}</td>
                      <td>{row.day || ""}</td>
                      <td>{row.name}</td>
                      <td>{row.spec}</td>
                      <td>{row.qtyNumber.toLocaleString("ko-KR")}</td>
                      <td>{row.unitPriceNumber.toLocaleString("ko-KR")}</td>
                      <td>{row.amount.toLocaleString("ko-KR")}</td>
                      <td>{row.note}</td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className="transaction-capture-total">
              <span>총수량: {totals.totalQty.toLocaleString("ko-KR")}</span>
              <span>공급가액: {settlement.supplyAmount.toLocaleString("ko-KR")}원</span>
              <span>세액: {settlement.taxAmount.toLocaleString("ko-KR")}원</span>
              <span>합계금액: {totals.totalAmount.toLocaleString("ko-KR")}원</span>
              <span>합계금액(한글): {settlement.amountKoreanText}</span>
            </div>
          </div>
        </div>

        {errorMessage ? <p className="transaction-error">{errorMessage}</p> : null}

        <div className="transaction-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading || jpgDownloading}
          >
            {downloading ? "다운로드 중..." : "거래명세표 Excel 다운로드"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleJpgDownload}
            disabled={jpgDownloading || downloading}
          >
            {jpgDownloading ? "거래명세표 JPG 생성중..." : "거래명세표 JPG 다운로드"}
          </button>
        </div>
      </section>
    </main>
  );
}
