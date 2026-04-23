import { createSizeAnalysisJob } from "@/features/sizeAnalysis/service";
import { readWorkbookFromFile } from "@/features/sizeAnalysis/workbook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "file이 필요합니다." }, { status: 400 });
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      return Response.json({ error: "xlsx/csv 파일만 지원합니다." }, { status: 400 });
    }
    const workbook = await readWorkbookFromFile(file);
    const jobId = await createSizeAnalysisJob({
      fileName: file.name,
      fileType: lower.endsWith(".csv") ? "csv" : "xlsx",
      workbook,
    });
    return Response.json({
      jobId,
      sheets: workbook.sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "업로드 처리 실패" },
      { status: 500 }
    );
  }
}

