import { detectStructure } from "@/features/sizeAnalysis/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jobId?: string; sheetName?: string };
    if (!body.jobId || !body.sheetName) {
      return Response.json({ error: "jobId/sheetName이 필요합니다." }, { status: 400 });
    }
    const result = await detectStructure(body.jobId, body.sheetName);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "구조 탐지 실패" },
      { status: 500 }
    );
  }
}

