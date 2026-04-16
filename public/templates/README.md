`transaction.xlsx` 파일을 이 폴더에 배치하면
`/api/documents/transaction-statement/xlsx` 라우트가 템플릿으로 사용합니다.

- 기대 경로: `public/templates/transaction.xlsx`
- 템플릿 누락 시 API는 500 에러로 명확한 메시지를 반환합니다.
