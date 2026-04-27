"use client";

import { amountToKoreanText } from "./amountToKoreanText";

export type EstimateSheetItem = {
  id?: string;
  category?: string;
  name: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  note?: string;
  isExtra?: boolean;
};

export type EstimateSheetData = {
  date: string;
  receiverName: string;
  eventName?: string;
  memo?: string;
  totalNote?: string;
};

export type EstimateSheetSupplier = {
  businessNumber?: string;
  companyName?: string;
  ceoName?: string;
  address?: string;
  tel?: string;
  fax?: string;
  bankAccount?: string;
  managerName?: string;
  managerPhone?: string;
  email?: string;
};

export type EstimateSheetProps = {
  data: EstimateSheetData;
  items: EstimateSheetItem[];
  supplier: EstimateSheetSupplier;
  vatIncluded: boolean;
  captureFixed?: boolean;
};

export function EstimateSheet({ data, items, supplier, vatIncluded, captureFixed = false }: EstimateSheetProps) {
  const normalItems = items.filter((item) => !item.isExtra);
  const extraItems = items.filter((item) => item.isExtra);
  const supplierTel = supplier.tel || "032-468-0351";
  const supplierFax = supplier.fax || "032-468-0332";

  const totalAmount = normalItems.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    return sum + qty * unitPrice;
  }, 0);

  return (
    <div className={`estimate-sheet__root${captureFixed ? " estimate-sheet__capture-fixed" : ""}`} data-estimate-print-sheet>
      <div className="estimate-sheet__title">견 적 서</div>

      <div className="estimate-sheet__top">
        <div className="estimate-sheet__receiver">
          <div className="estimate-sheet__receiver-row">
            <span className="estimate-sheet__receiver-label">견적일</span>
            <span className="estimate-sheet__receiver-value">{data.date || ""}</span>
          </div>
          <div className="estimate-sheet__receiver-row">
            <span className="estimate-sheet__receiver-label">수신</span>
            <strong className="estimate-sheet__receiver-value estimate-sheet__receiver-value--name">{data.receiverName || ""}</strong>
          </div>
          <div className="estimate-sheet__receiver-row">
            <span className="estimate-sheet__receiver-label">행사명</span>
            <span className="estimate-sheet__receiver-value">{data.eventName || ""}</span>
          </div>
        </div>

        <div className="estimate-sheet__supplier">
          <table>
            <tbody>
              <tr>
                <th rowSpan={4} className="estimate-sheet__supplier-role">
                  공<br />급<br />자
                </th>
                <th>등록번호</th>
                <td colSpan={3} className="estimate-sheet__supplier-business-number">
                  {supplier.businessNumber || ""}
                </td>
              </tr>
              <tr>
                <th>상호</th>
                <td>{supplier.companyName || ""}</td>
                <th>대표</th>
                <td className="estimate-sheet__ceo">
                  <span className="estimate-sheet__ceo-line">
                    <span>{supplier.ceoName || ""}</span>
                    <span className="estimate-sheet__ceo-seal">
                      <span className="estimate-sheet__ceo-in">(인)</span>
                      <img
                        src="/images/transaction-template-image1.png"
                        alt=""
                        width={76}
                        height={76}
                        decoding="async"
                        className="estimate-sheet__stamp-seal"
                      />
                    </span>
                  </span>
                </td>
              </tr>
              <tr>
                <th>주소</th>
                <td colSpan={3} className="estimate-sheet__supplier-address">
                  {supplier.address || ""}
                </td>
              </tr>
              <tr>
                <th>전화</th>
                <td>{supplierTel}</td>
                <th>팩스</th>
                <td>{supplierFax}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="estimate-sheet__notice">* 아래와 같이 견적하오니, 검토하여 주시기 바랍니다.</div>

      <div className="estimate-sheet__amount">
        <div className="estimate-sheet__amount-label">견적금액</div>
        <div className="estimate-sheet__amount-text">{amountToKoreanText(totalAmount)}</div>
        <div className="estimate-sheet__amount-number">₩{totalAmount.toLocaleString("ko-KR")}</div>
        <div className="estimate-sheet__vat">{vatIncluded ? "부가세포함" : "부가세별도"}</div>
      </div>

      <table className="estimate-sheet__items">
        <thead>
          <tr>
            <th>구분</th>
            <th>품명</th>
            <th>수량</th>
            <th>단위</th>
            <th>단가</th>
            <th>금액</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          {normalItems.map((item, index) => {
            const amount = Number(item.quantity || 0) * Number(item.unitPrice || 0);
            return (
              <tr key={item.id ?? index}>
                <td>{item.category || ""}</td>
                <td>{item.name}</td>
                <td>{Number(item.quantity || 0).toLocaleString("ko-KR")}</td>
                <td>{item.unit || "개"}</td>
                <td>{Number(item.unitPrice || 0).toLocaleString("ko-KR")}</td>
                <td>{amount.toLocaleString("ko-KR")}</td>
                <td>{item.note || ""}</td>
              </tr>
            );
          })}
          {Array.from({ length: Math.max(0, 4 - normalItems.length) }).map((_, index) => (
            <tr key={`normal-empty-${index}`}>
              <td>&nbsp;</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="estimate-sheet__total">
        <div>용 품 합 계</div>
        <strong>₩{totalAmount.toLocaleString("ko-KR")}</strong>
      </div>

      <table className="estimate-sheet__items estimate-sheet__items--extra">
        <thead>
          <tr>
            <th>구분</th>
            <th>품명</th>
            <th>수량</th>
            <th>단위</th>
            <th>단가</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {extraItems.map((item, index) => (
            <tr key={item.id ?? `extra-${index}`}>
              <td>{item.category || ""}</td>
              <td>{item.name}</td>
              <td>{Number(item.quantity || 0).toLocaleString("ko-KR")}</td>
              <td>{item.unit || "개"}</td>
              <td />
              <td />
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 3 - extraItems.length) }).map((_, index) => (
            <tr key={`extra-empty-${index}`}>
              <td>&nbsp;</td>
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="estimate-sheet__memo-title">비 고</div>
      <div className="estimate-sheet__memo">{data.memo || "\n\n\n"}</div>

      <div className="estimate-sheet__footer">
        <div className="estimate-sheet__footer-notice">
          <div>* 입금계좌 : {supplier.bankAccount || ""}</div>
          <div>* 세금계산서 100% 발행합니다. (카드결재시 수수료 3% 별도)</div>
          <div>* 상기 견적은 본 대회시에만 적용하며, A/S 가능합니다.</div>
          <div>* 품목은 요청 및 상황에 따라 변동 될 수 있습니다.</div>
          <div>* 문의사항은 홈페이지를 참고하시거나 본사로 연락 바랍니다.</div>
        </div>
        <div className="estimate-sheet__logo">
          <strong>TAGO</strong>
          <div>www.tagosports.co.kr</div>
        </div>
      </div>

      <div className="estimate-sheet__manager">
        <span>담당자</span>
        <span>{supplier.managerName || ""}</span>
        <span>연락처</span>
        <span>{supplier.managerPhone || ""}</span>
        <span>{supplier.email || ""}</span>
      </div>
    </div>
  );
}
