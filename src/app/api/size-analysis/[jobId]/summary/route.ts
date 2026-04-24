import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: { jobId: string } }) {
  const rows = await prisma.sizeAnalysisRow.findMany({
    where: { jobId: ctx.params.jobId },
    select: {
      parseStatus: true,
      qtyParsed: true,
      excluded: true,
      standardizedSize: true,
      clubNameNormalized: true,
      genderNormalized: true,
    },
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
  /** 클럽·성별·사이즈별 수량 */
  const clubGenderSize = new Map<string, { club: string; gender: string; size: string; qty: number }>();

  for (const row of rows) {
    statusCounts[row.parseStatus] += 1;
    const qty = row.qtyParsed ?? 0;
    if (!row.excluded) {
      originalTotalQty += qty;
      aggregatedTotalQty += qty;
      const club = row.clubNameNormalized || "미분류";
        const gender = String(row.genderNormalized ?? "").trim();
      const size = row.standardizedSize || "미분류";
      clubSize[club] = clubSize[club] ?? {};
      clubSize[club][size] = (clubSize[club][size] ?? 0) + qty;

        const key = `${club}\0${gender}\0${size}`;
        const cur = clubGenderSize.get(key) ?? { club, gender, size, qty: 0 };
        cur.qty += qty;
        clubGenderSize.set(key, cur);
    }
  }

  const genderOrder = (g: string) => {
    const t = String(g ?? "").trim();
    if (t === "남") return 0;
    if (t === "여") return 1;
    if (t === "공용" || t === "") return 2;
    return 3;
  };

  const sizeOrder = (size: string): { kind: 0 | 1; num: number; text: string } => {
    const t = String(size ?? "").trim();
    if (/^\d+$/.test(t)) return { kind: 0, num: Number(t), text: t };
    return { kind: 1, num: Number.POSITIVE_INFINITY, text: t };
  };

  const compareSize = (a: string, b: string) => {
    const aa = sizeOrder(a);
    const bb = sizeOrder(b);
    if (aa.kind !== bb.kind) return aa.kind - bb.kind;
    if (aa.kind === 0) return aa.num - bb.num;
    return aa.text.localeCompare(bb.text, "ko");
  };

  const clubSizeStatusRows = Array.from(clubGenderSize.values()).sort(
    (a, b) =>
      a.club.localeCompare(b.club, "ko") ||
      genderOrder(a.gender) - genderOrder(b.gender) ||
      a.gender.localeCompare(b.gender, "ko") ||
      compareSize(a.size, b.size)
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

