/**
 * 동일 매칭 키에 대한 수요를 행 순서대로 FCFS 할당.
 */

export type DemandAtom = {
  atomId: string;
  rowId: string;
  bundleKey: string | null;
  matchKey: string;
  quantity: number;
  sortOrder: number;
};

export type AtomAllocation = {
  allocated: number;
  shortage: number;
};

export function allocateDemandFcfs(
  atoms: DemandAtom[],
  initialStockByKey: Map<string, number>
): { perAtom: Map<string, AtomAllocation>; remainingStock: Map<string, number> } {
  const remaining = new Map(initialStockByKey);
  const perAtom = new Map<string, AtomAllocation>();
  const sorted = [...atoms].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const a of sorted) {
    const have = remaining.get(a.matchKey) ?? 0;
    const allocated = Math.min(a.quantity, have);
    const shortage = a.quantity - allocated;
    remaining.set(a.matchKey, have - allocated);
    perAtom.set(a.atomId, { allocated, shortage });
  }
  return { perAtom, remainingStock: remaining };
}
