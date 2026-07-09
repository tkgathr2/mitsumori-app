import { type NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  adminUsers,
  makeSessionToken,
  timingSafeEqualStr,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoogleTokenResponse = {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
};

type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean;
  name?: string;
};

function getGoogleEmailsMap(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const raw = env.ADMIN_GOOGLE_EMAILS_JSON;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map: Record<string, string> = {};
    for (const [email, user] of Object.entries(parsed)) {
      if (typeof user === "string" && user.trim()) {
        map[email.toLowerCase()] = user;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.redirect(new URL("/admin/login?error=not_configured", req.url));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // ユーザーが認可キャンセルした場合
  if (error) {
    return NextResponse.redirect(new URL(`/admin/login?error=${encodeURIComponent(error)}`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/admin/login?error=missing_code", req.url));
  }

  // state 検証（CSRF 対策）
  const storedState = req.cookies.get("oauth_state")?.value;
  if (!state || !storedState || !timingSafeEqualStr(state, storedState)) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid_state", req.url));
  }

  // code_verifier 取得（PKCE）
  const codeVerifier = req.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return NextResponse.redirect(new URL("/admin/login?error=missing_verifier", req.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_CALLBACK_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL("/admin/login?error=not_configured", req.url));
  }

  try {
    // token 交換
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL("/admin/login?error=token_exchange_failed", req.url));
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;

    // ユーザー情報取得
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error("Google userinfo failed:", await userRes.text());
      return NextResponse.redirect(new URL("/admin/login?error=userinfo_failed", req.url));
    }

    const userInfo = (await userRes.json()) as GoogleUserInfo;
    const email = userInfo.email?.toLowerCase();

    if (!email || !userInfo.email_verified) {
      return NextResponse.redirect(new URL("/admin/login?error=unverified_email", req.url));
    }

    // メール → ユーザー特定
    const emailsMap = getGoogleEmailsMap();
    const user = emailsMap[email];

    if (!user || !adminUsers()[user]) {
      // メール未登録またはユーザーが存在しない
      return NextResponse.redirect(
        new URL(`/admin/login?error=${encodeURIComponent(`Email not authorized: ${email}`)}`, req.url)
      );
    }

    // セッション発行
    const token = await makeSessionToken(user);
    if (!token) {
      return NextResponse.redirect(new URL("/admin/login?error=session_failed", req.url));
    }

    const res = NextResponse.redirect(new URL("/admin", req.url));
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12時間
    });
    // PKCE cookies をクリア
    res.cookies.delete("oauth_code_verifier");
    res.cookies.delete("oauth_state");

    return res;
  } catch (e) {
    console.error("Google callback error:", e);
    return NextResponse.redirect(new URL("/admin/login?error=server_error", req.url));
  }
}
