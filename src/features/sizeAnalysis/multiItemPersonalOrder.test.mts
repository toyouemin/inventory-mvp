import assert from "node:assert/strict";

import { matrixDisplayFromSizeFields } from "./matrixSizeDisplay";
import { parseMultiItemPersonalOrder } from "./multiItemPersonalOrder";
import type { FieldMapping, SheetSnapshot } from "./types";

const sheet: SheetSnapshot = {
  name: "신청서",
  rows: [
    ["이름", "성별", "상의", "하의", "바람막이"],
    ["백청자", "여", "90", "85", "95"],
    ["민수", "남", "100", "", "110"],
  ],
};

const mapping: FieldMapping = {
  structureType: "multi_item_personal_order",
  headerRowIndex: 0,
  fields: {
    name: 0,
    gender: 1,
  },
  productColumns: [2, 3, 4],
};

const rows = parseMultiItemPersonalOrder("job-1", sheet, mapping, { requestedClubName: "테스트클럽.xlsx" });

assert.equal(rows.length, 5, "2명 x 상품 펼침(빈값 제외)");
assert.equal(rows[0]!.memberNameRaw, "백청자");
assert.equal(rows[0]!.itemRaw, "상의");
assert.equal(rows[0]!.sizeRaw, "90");
assert.equal(rows[3]!.memberNameRaw, "민수");
assert.equal(rows[3]!.itemRaw, "상의");
assert.equal(rows[4]!.itemRaw, "바람막이");
assert.equal(rows.every((r) => (r.qtyParsed ?? 0) === 1), true, "기본 수량 1");
assert.equal(rows.every((r) => String(r.clubNameRaw ?? "").includes("테스트클럽")), true, "클럽 fallback");

const unisexSheet: SheetSnapshot = {
  name: "공용신청",
  rows: [
    ["이름", "성별", "바람막이[공용]", "상의공용"],
    ["홍길동", "남", "남100", "90여"],
    ["김영희", "여", "여100", "95 여자"],
  ],
};
const unisexMapping: FieldMapping = {
  structureType: "multi_item_personal_order",
  headerRowIndex: 0,
  fields: { name: 0, gender: 1 },
  productColumns: [2, 3],
};
const unisexRows = parseMultiItemPersonalOrder("job-2", unisexSheet, unisexMapping, { requestedClubName: "테스트" });
const windRows = unisexRows.filter((r) => r.itemRaw?.includes("바람막이"));
const topRows = unisexRows.filter((r) => r.itemRaw?.includes("상의"));
assert.equal(windRows.length, 2);
assert.equal(windRows.every((r) => r.genderNormalized === "공용"), true, "공용 헤더는 공용 성별");
assert.equal(windRows.every((r) => r.standardizedSize === "100"), true, "공용 헤더는 남/여 접두 제거");
assert.equal(topRows.length, 2);
assert.equal(topRows.every((r) => r.genderNormalized === "공용"), true, "괄호 없는 공용 헤더도 공용 성별");
assert.equal(topRows.map((r) => r.standardizedSize).join(","), "90,95", "성별 토큰 위치 무관 제거 후 숫자 추출");
const matrixParsed = matrixDisplayFromSizeFields("공용90", "공용90", "공용");
assert.equal(matrixParsed.gender, "공용");
assert.equal(matrixParsed.size, "90");

console.log("multiItemPersonalOrder test passed", { totalRows: rows.length });
