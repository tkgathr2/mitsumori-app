import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildAuthorizeUrl, getOAuthConfig } from "@/lib/mf-oauth";

// MoneyForward OAuth 認可フロー開始エンドポイント。
// lib/mf-oauth.ts の設定（api.biz.moneyforward.com・MF_REDIRECT_URI）を単一の真実として使い、
// CSRF対策の state を httpOnly cookie に保存して認可画面へリダイレクトする。
// callback は /api/mf-callback（アプリポータル登録済みリダイレクトURIと一致させること）。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MF_STATE_COOKIE = "mf_oauth_state";

export async function GET(): Promise<NextResponse> {
  const { clientId, redirectUri } = getOAuthConfig();
  if (!clientId) {
    return NextResponse.json(
      { error: "MF_CLIENT_ID が未設定です" },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(
    buildAuthorizeUrl({ clientId, redirectUri, state })
  );
  res.cookies.set(MF_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10分あれば十分
  });
  return res;
}
