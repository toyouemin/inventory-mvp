import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: { jobId: string } }) {
  const job = await prisma.sizeAnalysisJob.findUnique({
    where: { id: ctx.params.jobId },
    include: {
      sheets: { orderBy: { createdAt: "asc" } },
      mappings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!job) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ job });
}

