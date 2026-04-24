import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: { jobId: string } }) {
  const rows = await prisma.sizeAnalysisRow.findMany({
    where: { jobId: ctx.params.jobId },
    select: { parseStatus: true, qtyParsed: true, excluded: true, standardizedSize: true, clubNameNormalized: true },
  });

  const statusCounts = {
    auto_confirmed: 0,
    needs_review: 0,
    unresolved: 0,
    corrected: 0,
    excluded: 0,
  };
  let originalTotalQty = 0;
  let aggregatedTotalQty = 0;
  const clubSize: Record<string, Record<string, number>> = {};
  /** 클럽·사이즈·파싱상태별 수량(집계 총합은 기존 clubSize와 동일하게 유지) */
  const clubSizeByStatus = new Map<string, { club: string; size: string; parseStatus: string; qty: number }>();

  for (const row of rows) {
    statusCounts[row.parseStatus] += 1;
    const qty = row.qtyParsed ?? 0;
    if (!row.excluded) {
      originalTotalQty += qty;
      aggregatedTotalQty += qty;
      const club = row.clubNameNormalized || "미분류";
      const size = row.standardizedSize || "미분류";
      const st = row.parseStatus;
      clubSize[club] = clubSize[club] ?? {};
      clubSize[club][size] = (clubSize[club][size] ?? 0) + qty;

      const key = `${club}\0${size}\0${st}`;
      const cur = clubSizeByStatus.get(key) ?? { club, size, parseStatus: st, qty: 0 };
      cur.qty += qty;
      clubSizeByStatus.set(key, cur);
    }
  }

  const statusOrder = (s: string) => {
    const o: Record<string, number> = {
      auto_confirmed: 0,
      corrected: 1,
      needs_review: 2,
      unresolved: 3,
    };
    return o[s] ?? 9;
  };

  const clubSizeStatusRows = Array.from(clubSizeByStatus.values()).sort(
    (a, b) =>
      a.club.localeCompare(b.club, "ko") ||
      a.size.localeCompare(b.size, "ko") ||
      statusOrder(a.parseStatus) - statusOrder(b.parseStatus)
  );

  return Response.json({
    totalRows: rows.length,
    ...statusCounts,
    originalTotalQty,
    aggregatedTotalQty,
    verificationMatched: originalTotalQty === aggregatedTotalQty,
    clubSize,
    clubSizeStatusRows,
  });
}

