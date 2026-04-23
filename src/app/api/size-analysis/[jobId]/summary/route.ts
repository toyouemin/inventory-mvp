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

  for (const row of rows) {
    statusCounts[row.parseStatus] += 1;
    const qty = row.qtyParsed ?? 0;
    if (!row.excluded) {
      originalTotalQty += qty;
      aggregatedTotalQty += qty;
      const club = row.clubNameNormalized || "미분류";
      const size = row.standardizedSize || "미분류";
      clubSize[club] = clubSize[club] ?? {};
      clubSize[club][size] = (clubSize[club][size] ?? 0) + qty;
    }
  }

  return Response.json({
    totalRows: rows.length,
    ...statusCounts,
    originalTotalQty,
    aggregatedTotalQty,
    verificationMatched: originalTotalQty === aggregatedTotalQty,
    clubSize,
  });
}

