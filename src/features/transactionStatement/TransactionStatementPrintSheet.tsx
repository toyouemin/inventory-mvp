"use client";

import { forwardRef, type ReactNode } from "react";
import styles from "./TransactionStatementPrintSheet.module.css";

export type TransactionStatementPrintParty = {
  name: string;
  bizNo: string;
  representative: string;
  address: string;
  businessType: string;
  businessItem: string;
};

export type TransactionStatementPrintLine = {
  id: string;
  name: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
  note: string;
};

export type TransactionStatementPrintFooter = {
  /** 푸터 왼쪽 안내 (2줄 정도) */
  legalLeftLines: string[];
  /** 우측 로고(없으면 rightLogoText 사용) */
  rightLogoImageSrc?: string;
  rightLogoText?: string;
  bankLine?: string;
  website?: string;
};

export type TransactionStatementPrintSheetProps = {
  supplier: TransactionStatementPrintParty;
  customer: TransactionStatementPrintParty;
  issueDate: string;
  /** 거래일자 바에 표시 (미입력 시 issueDate와 동일) */
  tradeDate?: string;
  lines: TransactionStatementPrintLine[];
  totalQty: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  totalAmountKorean: string;
  stampSrc?: string;
  printFooter?: TransactionStatementPrintFooter | null;
  /** false면 공급가액·세액·VAT문구·푸터 세금 안내 등 부가세 관련 표시 숨김 */
  showVatIncluded?: boolean;
  /** 숨김 JPG 캡처용: 뷰포트와 무관한 고정 데스크톱 레이아웃만 적용 */
  captureFixed?: boolean;
};

const PARTY_FIELDS: Array<{ key: keyof TransactionStatementPrintParty; label: string }> = [
  { key: "name", label: "상호" },
  { key: "bizNo", label: "사업자번호" },
  { key: "representative", label: "성명" },
  { key: "businessType", label: "업태" },
  { key: "businessItem", label: "종목" },
  { key: "address", label: "사업장주소" },
];

function CalendarIcon() {
  return (
    <svg className={styles.tradeDateIcon} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

const PartyBlock = ({
  title,
  party,
  className,
  stamp,
}: {
  title: string;
  party: TransactionStatementPrintParty;
  className: string;
  stamp?: ReactNode;
}) => (
  <div className={className}>
    {stamp ?? null}
    <div className={styles.partyHeader}>{title}</div>
    <div className={styles.partyBody}>
      {PARTY_FIELDS.map(({ key, label }) => {
        const raw = (party[key] || "").trim() || "—";
        const normalizedDigits = key === "bizNo" ? raw.replace(/\D/g, "") : "";
        const displayLabel = key === "bizNo" && normalizedDigits.length === 11 ? "핸드폰 번호" : label;
        const valueClass =
          key === "bizNo"
            ? `${styles.partyValue} ${styles.partyValueBizNo}`
            : key === "address"
              ? `${styles.partyValue} ${styles.partyValueAddress}`
              : styles.partyValue;
        return (
          <div key={key} className={styles.partyRow}>
            <span className={styles.partyLabel}>{displayLabel}</span>
            <span className={styles.partyColon}>:</span>
            <span className={valueClass}>{raw}</span>
          </div>
        );
      })}
    </div>
  </div>
);

const DEFAULT_FOOTER: TransactionStatementPrintFooter = {
  legalLeftLines: [
    "본 거래명세표는 거래 내역 확인용이며, 세금계산서와 별개로 발행될 수 있습니다.",
    "부가가치세법에 따른 세금계산서는 별도로 수취해 주시기 바랍니다.",
  ],
  rightLogoText: "(주)세림통상",
  bankLine: "",
  website: "",
};

export const TransactionStatementPrintSheet = forwardRef<HTMLDivElement, TransactionStatementPrintSheetProps>(
  function TransactionStatementPrintSheet(
    {
      supplier,
      customer,
      issueDate,
      tradeDate,
      lines,
      totalQty,
      supplyAmount,
      taxAmount,
      totalAmount,
      totalAmountKorean,
      stampSrc = "/images/transaction-template-image1.png",
      printFooter,
      showVatIncluded = true,
      captureFixed = false,
    },
    ref
  ) {
    const tradeYmd = ((tradeDate ?? issueDate) || "").trim() || "—";
    const footer = printFooter === null ? null : { ...DEFAULT_FOOTER, ...printFooter };
    const legalLines = footer?.legalLeftLines ?? [];
    const hasLegalFooter = legalLines.length > 0;
    const captureCls = captureFixed ? " ts-print-capture-fixed" : "";
    const titleCaptureCls = captureFixed ? " ts-print-title" : "";
    const issueCaptureCls = captureFixed ? " ts-print-issue-date" : "";

    return (
      <div ref={ref} className={`${styles.sheet}${captureCls}`} data-ts-print-sheet>
        <header className={styles.header}>
          <div className={styles.headerSpacer} aria-hidden />
          <h1 className={`${styles.title}${titleCaptureCls}`}>거 래 명 세 표</h1>
          <div className={`${styles.issueDate}${issueCaptureCls}`}>
            <span className={styles.issueDatePurpose}>(공급받는자용)</span>
            <span>발행일자 {issueDate || "—"}</span>
          </div>
        </header>

        <div className={styles.parties}>
          <div className={styles.partiesDivider} aria-hidden />
          <PartyBlock
            title="공급자"
            party={supplier}
            className={`${styles.partyCol} ${styles.partyColSupplier}`}
            stamp={
              <img
                className={captureFixed ? `${styles.stampOverlay} ts-print-stamp` : styles.stampOverlay}
                src={stampSrc}
                alt=""
                width={76}
                height={76}
                decoding="async"
              />
            }
          />
          <PartyBlock title="공급받는자" party={customer} className={`${styles.partyCol} ${styles.partyColCustomer}`} />
        </div>

        <div className={styles.tradeDateBar}>
          <CalendarIcon />
          <span className={styles.tradeDateText}>거래일자 {tradeYmd}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup>
              <col className={styles.colName} />
              <col className={styles.colSpec} />
              <col className={styles.colQty} />
              <col className={styles.colUnitPrice} />
              <col className={styles.colAmount} />
              <col className={styles.colNote} />
            </colgroup>
            <thead>
              <tr>
                <th>품목명</th>
                <th>규격</th>
                <th>수량</th>
                <th>단가</th>
                <th>금액</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.id}>
                  <td className={styles.cellName}>{row.name}</td>
                  <td>{row.spec}</td>
                  <td className={styles.cellNum}>{row.qty.toLocaleString("ko-KR")}</td>
                  <td className={styles.cellNum}>{row.unitPrice.toLocaleString("ko-KR")}</td>
                  <td className={styles.cellNum}>{row.amount.toLocaleString("ko-KR")}</td>
                  <td className={styles.cellNote}>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.totals}>
          <div className={styles.totalsLeft}>
            <div className={styles.totalLine}>
              <span className={styles.totalLineLabel}>총수량</span>
              <span className={styles.totalLineValue}>{totalQty.toLocaleString("ko-KR")}</span>
            </div>
            {showVatIncluded ? (
              <>
                <div className={styles.totalLine}>
                  <span className={styles.totalLineLabel}>공급가액</span>
                  <span className={styles.totalLineValue}>{supplyAmount.toLocaleString("ko-KR")}</span>
                </div>
                <div className={styles.totalLine}>
                  <span className={styles.totalLineLabel}>세액(VAT)</span>
                  <span className={styles.totalLineValue}>{taxAmount.toLocaleString("ko-KR")}</span>
                </div>
              </>
            ) : null}
          </div>
          <div className={styles.totalsRight}>
            <div className={styles.totalHighlightTop}>
              <span className={styles.totalHighlightLabel}>
                {showVatIncluded ? "합계금액 (VAT포함)" : "합계금액"}
              </span>
              <span className={styles.totalHighlightNum}>{totalAmount.toLocaleString("ko-KR")}원</span>
            </div>
            <div className={styles.totalHighlightBottom}>
              <span className={styles.totalKoreanLabel}>합계금액(한글)</span>
              <span className={styles.totalKoreanValue}>{totalAmountKorean}</span>
            </div>
          </div>
        </div>

        {footer ? (
          <footer className={`${styles.printFooter}${hasLegalFooter ? "" : ` ${styles.printFooterRightOnly}`}`}>
            {hasLegalFooter ? (
              <div className={styles.printFooterLeft}>
                {legalLines.map((line, i) => (
                  <p key={i} className={styles.printFooterLegal}>
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            <div className={styles.printFooterRight}>
              {footer.bankLine ? <p className={`${styles.printFooterMeta} ${styles.printFooterBankLine}`}>{footer.bankLine}</p> : null}
              <div className={styles.printFooterBrandRow}>
                {footer.rightLogoImageSrc ? (
                  <img src={footer.rightLogoImageSrc} alt="" className={styles.printFooterLogo} decoding="async" />
                ) : footer.rightLogoText ? (
                  <span className={styles.printFooterBrand}>{footer.rightLogoText}</span>
                ) : null}
                {footer.website ? <p className={styles.printFooterMeta}>{footer.website}</p> : null}
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    );
  }
);
