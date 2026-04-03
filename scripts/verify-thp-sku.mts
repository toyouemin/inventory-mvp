/**
 * 상품 CSV 파이프라인 검증 (DB 없음).
 * 사용: npx tsx scripts/verify-thp-sku.mts [csv경로]
 * 기본: fixtures/thp200446ch-sample.csv
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProductCsvPipeline, type ParsedCsvRow } from "../src/app/products/csvProductPipeline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultCsv = join(__dirname, "..", "fixtures", "thp200446ch-sample.csv");
const csvPath = process.argv[2] ?? defaultCsv;
const TARGET_SKU = "THP200446CH";

const warn = console.warn;
const warnings: unknown[] = [];
console.warn = (...args: unknown[]) => {
  warnings.push(args);
  warn.apply(console, args);
};

const text = readFileSync(csvPath, "utf8");
let rows: ParsedCsvRow[];
let skippedRows: number[];
try {
  const out = runProductCsvPipeline(text);
  rows = out.rows;
  skippedRows = out.skippedRows;
} catch (e) {
  console.error("파이프라인 실패:", e);
  process.exit(1);
}

console.warn = warn;

const group = rows.filter((r) => r.sku === TARGET_SKU);
const distinctSku = new Set(rows.map((r) => r.sku));

console.log("\n=== THP200446CH 파이프라인 결과 ===\n");
console.log("CSV 파일:", csvPath);
console.log("스킵된 행(라인):", skippedRows.length ? skippedRows : "(없음)");
console.log("전체 유효 행 수:", rows.length);
console.log("고유 SKU 수:", distinctSku.size);
console.log(`${TARGET_SKU} 행 수:`, group.length);

if (group.length === 0) {
  console.log("\n이 CSV에 해당 SKU가 없습니다. 다른 파일로 다시 실행하세요.");
  process.exit(0);
}

const repNameSpec = group[0]?.nameSpec ?? "";
const allSameNameSpec = group.every((r) => r.nameSpec === repNameSpec);
const rawAllEqual = group.every((r) => r.rawNameSpec === group[0]?.rawNameSpec);

console.log("\n--- 대표 상품명 (nameSpec, DB products.name_spec에 쓰일 값) ---");
console.log(JSON.stringify(repNameSpec));
console.log("그룹 내 nameSpec 전부 동일:", allSameNameSpec);
console.log("rawNameSpec 전 행 동일(이면 안 됨):", rawAllEqual);

console.log("\n--- Variant 목록 (size = 옵션 문자열) ---");
group.forEach((r, i) => {
  console.log(
    `${i + 1}. dataRow#${r.dataRowIndex} size=${JSON.stringify(r.size)} | optionTag=${JSON.stringify(r.optionTag)} | gender=${JSON.stringify(r.gender)} | optionParts=${JSON.stringify(r.optionParts)}`
  );
  console.log(`   rawNameSpec=${JSON.stringify(r.rawNameSpec)}`);
});

console.log("\n--- console.warn 요약 ---");
console.log("경고 호출 횟수:", warnings.length);

const checks = {
  "1. name 불일치 throw 없음": true,
  "2. 상품 1개(SKU 1종)": distinctSku.size === 1 && group.length === rows.length,
  "3. variant 10개": group.length === 10,
  "4. rawNameSpec 행마다 보존(샘플은 서로 다름)": !rawAllEqual,
  "5. 대표명이 특정 행 raw 전체와 같지 않음": group.every((r) => r.nameSpec.trim() !== r.rawNameSpec.trim()),
  "6. nameSpec은 공통 base로 통일": allSameNameSpec,
};

console.log("\n--- 확인 포인트(샘플 기준) ---");
for (const [k, v] of Object.entries(checks)) {
  console.log(`${v ? "✓" : "✗"} ${k}`);
}

const has3or4 = group.every(
  (r) =>
    (r.optionParts ?? []).some((p) => /^\d+부/.test(p)) &&
    (r.size.includes("남") || r.size.includes("여")) &&
    /\d|W\d+/i.test(r.size)
);
console.log(`${has3or4 ? "✓" : "✗"} 3부/4부·남/여·사이즈가 size 문자열에 반영(샘플 휴리스틱)`);

process.exit(0);
