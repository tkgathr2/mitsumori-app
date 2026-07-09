import { type NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  makeSessionToken,
  verifyPassword,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "管理機能が未設定です（ADMIN_USERS_JSON 未設定）" },
      { status: 503 }
    );
  }

  let body: { user?: string; password?: string };
  try {
    body = (await req.json()) as { user?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // user 省略時は旧 ADMIN_PASSWORD 運用（user="admin"）の後方互換。
  const user = (body.user ?? "admin").trim();
  if (!body.password || !verifyPassword(user, body.password)) {
    return NextResponse.json(
      { error: "ユーザーまたはパスワードが違います" },
      { status: 401 }
    );
  }

  const token = await makeSessionToken(user);
  if (!token) {
    return NextResponse.json(
      { error: "セッション発行に失敗しました" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12時間
  });
  return res;
}
