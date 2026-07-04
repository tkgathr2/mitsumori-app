import { type NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminPasswordConfigured,
  makeSessionToken,
  verifyPassword,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!adminPasswordConfigured()) {
    return NextResponse.json(
      { error: "管理機能が未設定です（ADMIN_PASSWORD 未設定）" },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.password || !verifyPassword(body.password)) {
    return NextResponse.json(
      { error: "パスワードが違います" },
      { status: 401 }
    );
  }

  const token = await makeSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "セッション発行に失敗しました" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12時間
  });
  return res;
}
