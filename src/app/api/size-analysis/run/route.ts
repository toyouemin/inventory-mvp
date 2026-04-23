import { runAnalysis } from "@/features/sizeAnalysis/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jobId?: string };
    if (!body.jobId) {
      return Response.json({ error: "jobId가 필요합니다." }, { status: 400 });
    }
    const summary = await runAnalysis(body.jobId);
    return Response.json({ summary });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "실행 실패" },
      { status: 500 }
    );
  }
}

