import { NextResponse } from "next/server";
import { getAssetVersion } from "@/lib/assetVersion";

export const dynamic = "force-dynamic";
// Vercel에서 기본 런타임이 edge로 잡히면 process.env 접근이 실패할 수 있어 nodejs로 강제합니다.
export const runtime = "nodejs";

/**
 * PC·모바일이 같은 배포를 보는지 비교용(민감 정보 없음).
 * 예: https://your-domain.com/api/debug/build
 */
export async function GET() {
  try {
    const body = {
      ok: true,
      now: new Date().toISOString(),
      assetVersion: getAssetVersion(),
      vercelGitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      nodeEnv: process.env.NODE_ENV,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    // secrets 없이 에러 형태만 반환합니다.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        now: new Date().toISOString(),
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
