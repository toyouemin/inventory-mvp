import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSingleRowPerson } from "./strategies";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const sample2Path = join(projectRoot, "fixtures", "size_analysis_sample_2_split_columns.csv");

function loadSample2Sheet() {
  const text = readFileSync(sample2Path, "utf-8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.map((line) => line.split(",").map((v) => v.trim()));
  return { name: "Sheet1", rows };
}

const jobId = "j1";
// 이름,클럽,성별,사이즈,수량
const mappingSplit = {
  structureType: "single_row_person" as const,
  headerRowIndex: 0,
  fields: { name: 0, club: 1, gender: 2, size: 3, qty: 4 },
};

const rows = parseSingleRowPerson(jobId, loadSample2Sheet(), mappingSplit);
assert.equal(rows.length, 3, `expected 3 data rows, got ${rows.length}`);

assert.equal(rows[0]!.standardizedSize, "95");
assert.equal(rows[0]!.qtyParsed, 2, "qty must come from 수량 column, not 95 from size");
assert.equal(rows[1]!.standardizedSize, "100");
assert.equal(rows[1]!.qtyParsed, 1);
assert.equal(rows[2]!.standardizedSize, "105");
assert.equal(rows[2]!.qtyParsed, 3);

assert.equal(rows[0]!.parseStatus, "auto_confirmed");
assert.equal(rows[1]!.parseStatus, "auto_confirmed");
assert.equal(rows[2]!.parseStatus, "auto_confirmed");

// 수량 열 없음: "남 95"만 있을 때 95→수량 오인 → 1
const conflationSheet = {
  name: "S",
  rows: [
    ["이름", "성별", "사이즈"],
    ["테스트", "남", "95"],
  ],
};
const mappingNoQty = {
  structureType: "single_row_person" as const,
  headerRowIndex: 0,
  fields: { name: 0, gender: 1, size: 2 },
};
const cRows = parseSingleRowPerson(jobId, conflationSheet, mappingNoQty);
assert.equal(cRows.length, 1);
assert.equal(cRows[0]!.standardizedSize, "95");
assert.equal(cRows[0]!.qtyParsed, 1, "default qty when conflated with size, no qty column");

console.log("singleRowPerson test passed", { sample2Rows: rows.length });
