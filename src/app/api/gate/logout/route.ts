import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieName = process.env.APP_PASSWORD_COOKIE || "inventory_gate";

  const res = NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  );

  res.cookies.set(cookieName, "", {
    path: "/",
    maxAge: 0,
  });

  return res;
}