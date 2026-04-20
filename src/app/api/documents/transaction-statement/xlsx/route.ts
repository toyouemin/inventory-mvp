import { buildTransactionStatementData } from "@/features/transactionStatement/buildData";
import {
  exportTransactionStatementExcel,
  exportTransactionStatementExcelFromTemplateBuffer,
  TransactionTemplateFileMissingError,
} from "@/features/transactionStatement/exportExcel";
import type { TransactionStatementRequestBody } from "@/features/transactionStatement/types";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const TEMPLATE_RELATIVE_PATH = "public/templates/transaction.xlsx";

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
    const cwd = process.cwd();
    const templateAbsolutePath = path.resolve(cwd, TEMPLATE_RELATIVE_PATH);
    console.info("[transaction-statement:xlsx] runtime template check", {
      cwd,
      templateAbsolutePath,
      templateExists: existsSync(templateAbsolutePath),
    });

    const statementData = buildTransactionStatementData(body);
    let buffer: Uint8Array;
    try {
      buffer = await exportTransactionStatementExcel(statementData);
    } catch (error) {
      if (!(error instanceof TransactionTemplateFileMissingError)) throw error;

      const templateUrl = new URL(`/${TEMPLATE_RELATIVE_PATH.replace(/^public\//, "")}`, req.url);
      console.warn("[transaction-statement:xlsx] fs template missing; trying HTTP fallback", {
        templateUrl: templateUrl.toString(),
      });

      const templateResponse = await fetch(templateUrl, { cache: "no-store" });
      if (!templateResponse.ok) {
        throw new Error(`템플릿 HTTP fallback 실패: ${templateResponse.status} ${templateResponse.statusText}`);
      }
      const templateArrayBuffer = await templateResponse.arrayBuffer();
      buffer = await exportTransactionStatementExcelFromTemplateBuffer(
        statementData,
        new Uint8Array(templateArrayBuffer),
        `http-fallback:${templateUrl.toString()}`
      );
    }

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
    const err = error instanceof Error ? error : null;
    console.error("[transaction-statement:xlsx] route error", {
      message: err?.message ?? String(error),
      stack: err?.stack,
      cause: err && "cause" in err ? (err as Error & { cause?: unknown }).cause : undefined,
    });

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
