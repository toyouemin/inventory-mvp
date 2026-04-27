import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: { jobId: string } }) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const excludeExcluded = url.searchParams.get("excludeExcluded") === "1";

  const where: Prisma.SizeAnalysisRowWhereInput = { jobId: ctx.params.jobId };
  if (status === "excluded") {
    where.excluded = true;
    /** UI: excludedScope=duplicates → `excludeReason`이 duplicate_* 인 행만(0/빈 수량 제외는 제외) */
    if (url.searchParams.get("excludedScope") === "duplicates") {
      where.excludeReason = { startsWith: "duplicate_" };
    }
  } else if (status) {
    where.parseStatus = status as never;
  }
  if (excludeExcluded && status !== "excluded") {
    where.excluded = false;
  }

  const rows = await prisma.sizeAnalysisRow.findMany({
    where,
    orderBy: [{ sourceRowIndex: "asc" }, { sourceGroupIndex: "asc" }],
    take: 2000,
  });
  return Response.json({ rows });
}

