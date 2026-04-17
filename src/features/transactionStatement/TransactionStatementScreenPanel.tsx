"use client";

import styles from "./TransactionStatementScreenPanel.module.css";

export type TransactionStatementScreenLine = {
  id: string;
  name: string;
  qty: number;
  amount: number;
};

export type TransactionStatementScreenPanelProps = {
  issueDate: string;
  tradeDateYmd: string;
  customerName: string;
  lines: TransactionStatementScreenLine[];
  totalQty: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountKoreanText: string;
  onOpenPrintPreview: () => void;
};

export function TransactionStatementScreenPanel({
  issueDate,
  tradeDateYmd,
  customerName,
  lines,
  totalQty,
  supplyAmount,
  taxAmount,
  totalAmount,
  amountKoreanText,
  onOpenPrintPreview,
}: TransactionStatementScreenPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="transaction-screen-heading">
      <h2 id="transaction-screen-heading" className={styles.panelTitle}>
        거래 요약
      </h2>
      <dl className={styles.grid}>
        <div className={styles.kv}>
          <dt>발행일자</dt>
          <dd>{issueDate || "—"}</dd>
        </div>
        <div className={styles.kv}>
          <dt>거래일자</dt>
          <dd>{tradeDateYmd || "—"}</dd>
        </div>
        <div className={`${styles.kv} ${styles.kvFull}`}>
          <dt>공급받는자 상호</dt>
          <dd>{customerName.trim() || "—"}</dd>
        </div>
      </dl>

      <div className={styles.itemsWrap}>
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th>품목명</th>
              <th>수량</th>
              <th>금액</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={3}>입력된 품목이 없습니다.</td>
              </tr>
            ) : (
              lines.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.qty.toLocaleString("ko-KR")}</td>
                  <td>{row.amount.toLocaleString("ko-KR")}원</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.totals}>
        <div className={styles.totalsPrimary}>
          <span className={styles.totalsAmount}>합계 {totalAmount.toLocaleString("ko-KR")}원</span>
          <span className={styles.totalsMeta}>
            총수량 {totalQty.toLocaleString("ko-KR")} · 공급 {supplyAmount.toLocaleString("ko-KR")} · 세액{" "}
            {taxAmount.toLocaleString("ko-KR")}
          </span>
        </div>
        <div className={styles.totalsKorean}>{amountKoreanText}</div>
      </div>

      <div className={styles.previewRow}>
        <button type="button" className={`btn btn-secondary ${styles.previewBtn}`} onClick={onOpenPrintPreview}>
          출력 양식 미리보기
        </button>
      </div>
    </section>
  );
}
