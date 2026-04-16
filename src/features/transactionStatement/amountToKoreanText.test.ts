import assert from "node:assert/strict";

import { amountToKoreanText } from "./amountToKoreanText";

const cases: Array<{ input: number; expected: string }> = [
  { input: 0, expected: "영원 정" },
  { input: 10000, expected: "일만원 정" },
  { input: 105000, expected: "십만오천원 정" },
  { input: 2500000, expected: "이백오십만원 정" },
  { input: 123456789, expected: "일억이천삼백사십오만육천칠백팔십구원 정" },
];

for (const testCase of cases) {
  const actual = amountToKoreanText(testCase.input);
  assert.equal(
    actual,
    testCase.expected,
    `amountToKoreanText(${testCase.input}) expected "${testCase.expected}" but got "${actual}"`
  );
}

console.log("amountToKoreanText test passed:", cases.length, "cases");
