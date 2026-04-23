import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: { jobId: string } }) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const rows = await prisma.sizeAnalysisRow.findMany({
    where: {
      jobId: ctx.params.jobId,
      ...(status ? { parseStatus: status as never } : {}),
    },
    orderBy: [{ sourceRowIndex: "asc" }, { sourceGroupIndex: "asc" }],
    take: 2000,
  });
  return Response.json({ rows });
}

