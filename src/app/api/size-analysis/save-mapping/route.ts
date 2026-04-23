import { saveMapping } from "@/features/sizeAnalysis/service";
import type { FieldMapping } from "@/features/sizeAnalysis/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jobId?: string; sheetName?: string; mapping?: FieldMapping };
    if (!body.jobId || !body.sheetName || !body.mapping) {
      return Response.json({ error: "jobId/sheetName/mapping이 필요합니다." }, { status: 400 });
    }
    await saveMapping(body.jobId, body.sheetName, body.mapping);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "매핑 저장 실패" },
      { status: 500 }
    );
  }
}

