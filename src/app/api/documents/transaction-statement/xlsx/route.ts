import { buildTransactionStatementData } from "@/features/transactionStatement/buildData";
import {
  exportTransactionStatementExcel,
  TransactionTemplateFileMissingError,
} from "@/features/transactionStatement/exportExcel";
import type { TransactionStatementRequestBody } from "@/features/transactionStatement/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatFileDate(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export async function POST(req: Request): Promise<Response> {
  let body: TransactionStatementRequestBody;
  try {
    body = (await req.json()) as TransactionStatementRequestBody;
  } catch {
    return new Response("유효한 JSON 요청 본문이 필요합니다.", { status: 400 });
  }

  try {
    const statementData = buildTransactionStatementData(body);
    const buffer = await exportTransactionStatementExcel(statementData);
    const fileName = `transaction-statement-${formatFileDate(new Date())}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    if (error instanceof TransactionTemplateFileMissingError) {
      return new Response(error.message, { status: 500 });
    }
    if (error instanceof RangeError) {
      return new Response(error.message, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "거래명세표 엑셀 생성에 실패했습니다.";
    return new Response(message, { status: 400 });
  }
}
