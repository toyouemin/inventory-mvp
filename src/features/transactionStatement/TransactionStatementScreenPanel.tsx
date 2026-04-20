"use client";

import styles from "./TransactionStatementScreenPanel.module.css";

export type TransactionStatementScreenLine = {
  id: string;
  name: string;
  spec: string;
  qty: number;
  amount: number;
};

export type TransactionStatementScreenPanelProps = {
  issueDate: string;
  tradeDateYmd: string;
  /** 고정 공급자 */
  supplierName: string;
  supplierBizNo: string;
  supplierRepresentative: string;
  customerName: string;
  customerBizNo: string;
  customerRepresentative: string;
  lines: TransactionStatementScreenLine[];
  totalQty: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountKoreanText: string;
  /** 체크 시 부가세·공급/세액 요약 표시(출력·이미지와 동일) */
  showVatIncluded: boolean;
  onShowVatIncludedChange: (value: boolean) => void;
  onOpenPrintPreview: () => void;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function TransactionStatementScreenPanel({
  issueDate,
  tradeDateYmd,
  supplierName,
  supplierBizNo,
  supplierRepresentative,
  customerName,
  customerBizNo,
  customerRepresentative,
  lines,
  totalQty,
  supplyAmount,
  taxAmount,
  totalAmount,
  amountKoreanText,
  showVatIncluded,
  onShowVatIncludedChange,
  onOpenPrintPreview,
}: TransactionStatementScreenPanelProps) {
  const customerBizNoDigits = digitsOnly(customerBizNo);
  const customerBizNoFieldLabel =
    customerBizNoDigits.length === 11 ? "핸드폰 번호" : "사업자번호";

  return (
    <section className={styles.panel} aria-labelledby="transaction-screen-heading">
      <div className={styles.panelHeader}>
        <h2 id="transaction-screen-heading" className={styles.panelTitle}>
          거래 요약
        </h2>
        <label className={styles.vatToggle}>
          <span className={styles.vatToggleLabel}>부가세 포함 표시</span>
          <input
            type="checkbox"
            className={styles.vatToggleInput}
            checked={showVatIncluded}
            onChange={(e) => onShowVatIncludedChange(e.target.checked)}
          />
          <span className={styles.vatToggleTrack} aria-hidden />
        </label>
      </div>
      <div className={styles.summaryStack} role="group" aria-label="거래 요약 기본 정보">
        <div className={styles.summaryInline}>
          <span className={styles.summaryItem}>
            <strong>발행일자</strong> {issueDate || "—"}
          </span>
          <span className={`${styles.summaryItem} ${styles.summaryItemTradeDate}`}>
            <strong>거래일자</strong> {tradeDateYmd || "—"}
          </span>
        </div>
        <div className={styles.summaryPartyGrid}>
          <div className={styles.summaryPartyCol}>
            <span className={styles.summaryPartyTitle}>공급자</span>
            <span className={styles.summaryItem}>{supplierName.trim() || "—"}</span>
            <span className={styles.summaryItem}>
              <strong>사업자번호</strong> {supplierBizNo.trim() || "—"}
            </span>
            <span className={styles.summaryItem}>
              <strong>성명</strong> {supplierRepresentative.trim() || "—"}
            </span>
          </div>
          <div className={`${styles.summaryPartyCol} ${styles.summaryPartyColRight}`}>
            <span className={styles.summaryPartyTitle}>공급받는자</span>
            <span className={styles.summaryItem}>{customerName.trim() || "—"}</span>
            <span className={styles.summaryItem}>
              <strong>{customerBizNoFieldLabel}</strong> {customerBizNo.trim() || "—"}
            </span>
            <span className={styles.summaryItem}>
              <strong>성명</strong> {customerRepresentative.trim() || "—"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.itemsWrap}>
        <table className={styles.itemsTable}>
          <colgroup>
            <col className={styles.colProduct} />
            <col className={styles.colSpec} />
            <col className={styles.colQty} />
            <col className={styles.colAmount} />
          </colgroup>
          <thead>
            <tr>
              <th>품목명</th>
              <th>규격</th>
              <th>수량</th>
              <th>금액</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4}>입력된 품목이 없습니다.</td>
              </tr>
            ) : (
              lines.map((row) => (
                <tr key={row.id}>
                  <td className={styles.cellProduct}>{row.name}</td>
                  <td className={styles.cellSpec}>{row.spec}</td>
                  <td className={styles.cellQty}>{row.qty.toLocaleString("ko-KR")}</td>
                  <td className={styles.cellAmount}>{row.amount.toLocaleString("ko-KR")}원</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.totals}>
        <div className={styles.totalsPrimary}>
          <span className={styles.totalsAmount}>
            합계 금액 {totalAmount.toLocaleString("ko-KR")}원
            {showVatIncluded ? <span className={styles.totalsVat}>(VAT포함)</span> : null}
            <span className={styles.totalsAmountKorean}> ({amountKoreanText})</span>
          </span>
          {showVatIncluded ? (
            <span className={styles.totalsMeta}>
              총수량 {totalQty.toLocaleString("ko-KR")} · 공급 {supplyAmount.toLocaleString("ko-KR")} · 세액{" "}
              {taxAmount.toLocaleString("ko-KR")}
            </span>
          ) : (
            <span className={styles.totalsMeta}>총수량 {totalQty.toLocaleString("ko-KR")}</span>
          )}
        </div>
      </div>

      <div className={styles.previewRow}>
        <button type="button" className={`btn btn-secondary ${styles.previewBtn}`} onClick={onOpenPrintPreview}>
          출력 명세서 미리보기
        </button>
      </div>
    </section>
  );
}
