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

// 테스트4: unknown item 토막 규칙
const t4split = splitOrderItemSegments("95 1 / 105 1");
assert.equal(t4split.length, 2);
const t4a = parseManualItemOrderSegment(t4split[0]!);
const t4b = parseManualItemOrderSegment(t4split[1]!);
assert.equal(t4a.size, "95");
assert.equal(t4a.qty, 1);
assert.equal(t4a.status, "auto_confirmed");
assert.equal(t4b.size, "105");
assert.equal(t4b.qty, 1);

const t4free = parseManualItemOrderSegment("FREE 1");
assert.equal(t4free.size, "FREE");
assert.equal(t4free.status, "needs_review");

const t4td = parseManualItemOrderSegment("특대 2");
assert.equal(t4td.size, "특대");
assert.equal(t4td.qty, 2);
assert.equal(t4td.status, "needs_review");

const t4td2 = parseManualItemOrderSegment("특대2");
assert.equal(t4td2.qty, 2);
assert.equal(t4td2.status, "needs_review");

assert.equal(parseManualItemOrderSegment("95").status, "unresolved");

const t4dup = parseManualItemOrderSegment("95 95");
assert.equal(t4dup.size, "95");
assert.equal(t4dup.qty, 1);

const mw1 = parseManualItemOrderSegment("M100 1개");
assert.equal(mw1.gender, "남");
assert.equal(mw1.size, "100");
assert.equal(mw1.qty, 1);

const mw2 = parseManualItemOrderSegment("W95 1개");
assert.equal(mw2.gender, "여");
assert.equal(mw2.size, "95");
assert.equal(mw2.qty, 1);

const n100 = parseManualItemOrderSegment("100 2개");
assert.equal(n100.size, "100");
assert.equal(n100.qty, 2);

const mixed = splitOrderItemSegments("남 M 2 / 여 S 1 / 100 3").map((seg) => parseManualItemOrderSegment(seg));
assert.equal(mixed.length, 3);
assert.equal(mixed[0]!.gender, "남");
assert.equal(mixed[0]!.size, "M");
assert.equal(mixed[0]!.qty, 2);
assert.equal(mixed[1]!.gender, "여");
assert.equal(mixed[1]!.size, "S");
assert.equal(mixed[1]!.qty, 1);
assert.equal(mixed[2]!.size, "100");
assert.equal(mixed[2]!.qty, 3);

console.log("unknownManualItem test passed:", { totalRows: rows.length, allAuto: ok.length });
