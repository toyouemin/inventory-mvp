# 거래명세표 수동 검증 체크리스트

## 테스트 요청 데이터

- `transactionStatementSampleRequestBody`(`src/features/transactionStatement/sampleData.ts`)를 `POST /api/documents/transaction-statement/xlsx`로 호출

## 확인 항목

1. 공급자/공급받는자/거래일자/품목/총수량/합계금액 값이 의도한 셀에 입력되었는지 확인
2. 템플릿의 병합/테두리/폰트/정렬이 깨지지 않았는지 확인
3. 수량/단가/금액/합계 숫자 표시가 템플릿 서식에 맞게 보이는지 확인
4. 품목 2개가 각각 서로 다른 행(14행, 15행)에 들어갔는지 확인
5. 합계(`총수량=19`, `합계금액=369000`)가 샘플 데이터와 일치하는지 확인
6. 은행계좌/안내문구/고정 텍스트 등 템플릿의 빈 고정 문구가 훼손되지 않았는지 확인
