import { type NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

// MoneyForward OAuth 認可フロー開始エンドポイント。
// authorize URL へ state 付きでリダイレクトし、CSRF対策として
// state を httpOnly cookie にも保存しておく（callback側で突き合わせる）。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MF_AUTHORIZE_URL = "https://app.moneyforward.com/oauth/authorize";
const MF_STATE_COOKIE = "mf_oauth_state";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = process.env.MF_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "MF_CLIENT_ID が未設定です" },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/mf-auth/callback", req.nextUrl.origin).toString();

  const authorizeUrl = new URL(MF_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "read write");
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(MF_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10分あれば十分
  });
  return res;
}
