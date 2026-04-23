import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: { jobId: string } }) {
  try {
    const body = (await req.json()) as {
      rowId?: string;
      standardizedSize?: string | null;
      genderNormalized?: string | null;
      qtyParsed?: number | null;
      parseReason?: string | null;
    };
    if (!body.rowId) return Response.json({ error: "rowId가 필요합니다." }, { status: 400 });

    const updated = await prisma.sizeAnalysisRow.update({
      where: { id: body.rowId, jobId: ctx.params.jobId },
      data: {
        standardizedSize: body.standardizedSize ?? undefined,
        genderNormalized: body.genderNormalized ?? undefined,
        qtyParsed: body.qtyParsed ?? undefined,
        parseStatus: "corrected",
        parseConfidence: 1,
        parseReason: body.parseReason ?? "사용자 수동 수정",
        userCorrected: true,
      },
    });
    return Response.json({ row: updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "수정 실패" },
      { status: 500 }
    );
  }
}

