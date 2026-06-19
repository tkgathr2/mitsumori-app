import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  getOAuthConfig,
  oauthConfigured,
} from "@/lib/mf-oauth";

export const dynamic = "force-dynamic";

// MF OAuth 認可フローの開始。MFの認可画面へリダイレクトする。
// 認可後は redirect_uri (/api/mf-callback) に code 付きで戻る。
export async function GET(req: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "MF_CLIENT_ID / MF_CLIENT_SECRET が未設定です。Vercelの環境変数を設定してください。",
      },
      { status: 500 }
    );
  }

  const { clientId, redirectUri } = getOAuthConfig();

  // CSRF対策の state。HttpOnly cookie に保存し、callbackで照合する。
  const state = crypto.randomUUID();
  const url = buildAuthorizeUrl({ clientId, redirectUri, state });

  const res = NextResponse.redirect(url);
  res.cookies.set("mf_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10分
  });
  return res;
}
