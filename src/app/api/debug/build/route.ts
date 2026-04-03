import { NextResponse } from "next/server";
import { getAssetVersion } from "@/lib/assetVersion";

export const dynamic = "force-dynamic";

/**
 * PC·모바일이 같은 배포를 보는지 비교용(민감 정보 없음).
 * 예: https://your-domain.com/api/debug/build
 */
export async function GET() {
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
}
