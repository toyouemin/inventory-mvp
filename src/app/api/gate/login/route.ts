import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));

  const correct = process.env.APP_PASSWORD;
  const cookieName = process.env.APP_PASSWORD_COOKIE || "inventory_gate";

  if (!correct) {
    return NextResponse.json({ ok: false, reason: "APP_PASSWORD missing" }, { status: 500 });
  }

  if (password !== correct) {
    return NextResponse.json({ ok: false, reason: "wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}