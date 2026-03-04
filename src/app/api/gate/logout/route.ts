import { NextResponse } from "next/server";

export async function POST() {
  const cookieName = process.env.APP_PASSWORD_COOKIE || "inventory_gate";

  const res = NextResponse.json({ ok: true });

  res.cookies.set(cookieName, "", {
    path: "/",
    maxAge: 0,
  });

  return res;
}