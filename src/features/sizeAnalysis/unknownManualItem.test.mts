import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseUnknownManualItem } from "./strategies";
import { parseManualItemOrderSegment, splitOrderItemSegments } from "./normalize";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const samplePath = join(projectRoot, "fixtures", "size_analysis_sample_1_basic_rows.csv");

function loadCsvAsSheet() {
  const text = readFileSync(samplePath, "utf-8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.map((line) => line.split(",").map((v) => v.trim()));
  return { name: "Sheet1", rows };
}

const segHello = splitOrderItemSegments("남95 2장 / 여90 1장");
assert.deepEqual(segHello, ["남95 2장", "여90 1장"]);
assert.deepEqual(splitOrderItemSegments("a,b"), ["a", "b"]);
assert.deepEqual(splitOrderItemSegments("a，b"), ["a", "b"]);

const p1 = parseManualItemOrderSegment("남95 2장");
assert.equal(p1.status, "auto_confirmed");
assert.equal(p1.gender, "남");
assert.equal(p1.size, "95");
assert.equal(p1.qty, 2);

const p2 = parseManualItemOrderSegment("95 1");
assert.equal(p2.status, "auto_confirmed");
assert.equal(p2.size, "95");
assert.equal(p2.qty, 1);

const p3 = parseManualItemOrderSegment("XXL 1");
assert.equal(p3.status, "auto_confirmed");
assert.equal(p3.size, "2XL");
assert.equal(p3.qty, 1);

const jobId = "test-job";
const sheet = loadCsvAsSheet();
const mapping = {
  structureType: "unknown" as const,
  headerRowIndex: 0,
  fields: { name: 0, club: 1, item: 2 },
};

const rows = parseUnknownManualItem(jobId, sheet, mapping);
assert.equal(rows.length, 7, `expected 7 normalized rows, got ${rows.length}`);

const hong = rows.filter((r) => r.memberNameRaw === "홍길동");
assert.equal(hong.length, 2);
assert.equal(hong[0]!.standardizedSize, "95");
assert.equal(hong[0]!.genderNormalized, "남");
assert.equal(hong[0]!.qtyParsed, 2);
assert.equal(hong[1]!.standardizedSize, "90");
assert.equal(hong[1]!.genderNormalized, "여");
assert.equal(hong[1]!.qtyParsed, 1);

const kim = rows.filter((r) => r.memberNameRaw === "김철수");
assert.equal(kim.length, 3);
assert.equal(kim.map((r) => r.standardizedSize).join(","), "95,100,105");
assert.equal(kim.map((r) => r.qtyParsed).join(","), "1,2,1");

const park = rows.filter((r) => r.memberNameRaw === "박민수");
assert.equal(park.length, 2);
assert.equal(park[0]!.standardizedSize, "XL");
assert.equal(park[0]!.qtyParsed, 2);
assert.equal(park[1]!.standardizedSize, "2XL");
assert.equal(park[1]!.qtyParsed, 1);

const ok = rows.filter((r) => r.parseStatus === "auto_confirmed");
assert.equal(ok.length, 7);
assert.ok(rows.every((r) => (r.metaJson as { strategy?: string })?.strategy === "unknown_manual_item"));

console.log("unknownManualItem test passed:", { totalRows: rows.length, allAuto: ok.length });
