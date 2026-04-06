import { NextResponse } from "next/server";
import { cleanupProductImageOrphans } from "@/lib/productImagesStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 관리자 수동 점검:
 * GET  /api/admin/storage-orphans           -> dry-run
 * POST /api/admin/storage-orphans { dryRun?: boolean, confirm?: boolean }
 *   - 실제 삭제는 dryRun=false && confirm=true 일 때만 실행
 */
export async function GET() {
  try {
    const result = await cleanupProductImageOrphans({ dryRun: true, confirm: false });
    return NextResponse.json(
      { ok: true, mode: "dry-run", ...result },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun !== false;
  const confirm = body.confirm === true;

  try {
    const result = await cleanupProductImageOrphans({ dryRun, confirm });
    const mode = dryRun || !confirm ? "dry-run" : "delete";
    return NextResponse.json(
      {
        ok: true,
        mode,
        guard: {
          dryRun,
          confirm,
          deleteExecuted: !dryRun && confirm && result.failedPaths.length === 0 ? result.deletedCount > 0 : false,
        },
        ...result,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, dryRun, confirm },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }
}
