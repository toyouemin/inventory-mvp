/**
 * 할당 결과로 행·번들 상태 분류.
 */

import type { MatchStatus } from "./types";

export function classifyFromTotals(totalRequested: number, totalAllocated: number, totalShortage: number): MatchStatus {
  if (totalRequested <= 0) return "full";
  if (totalShortage <= 0) return "full";
  if (totalAllocated <= 0) return "impossible";
  return "partial";
}
