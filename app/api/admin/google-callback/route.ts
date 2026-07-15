import { type NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  adminUsers,
  makeSessionToken,
  timingSafeEqualStr,
} from "@/lib/admin-auth";
import { USER_COOKIE, isAllowedEmail, makeUserSessionToken } from "@/lib/user-auth";
import { recordAccessRequest, notifyAccessRequest } from "@/lib/access-requests-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoogleTokenResponse = {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
};

// https://www.googleapis.com/oauth2/v2/userinfo のフィールド名は "verified_email"
// （OIDCのv3 userinfoで使う "email_verified" とは名前が違う）。
type GoogleUserInfo = {
  email?: string;
  verified_email?: boolean;
  name?: string;
};

// Railway等のリバースプロキシ配下では req.url がコンテナ内部のホスト(localhost:8080等)を
// 指すことがあるため、redirect先の組み立ては x-forwarded-host / x-forwarded-proto を優先する。
function appOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

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

// このコールバックは /admin（既存の管理者ログイン）と /login（見積もり画面の一般ログイン）
// の両方から共有で使われる。両者は同じ Google OAuth クライアント・同じ登録済み
// リダイレクトURIを使い回すため、oauth_flow cookie（"admin" | "general"）で
// どちらのログインだったかを判別する（未設定時は後方互換で "admin" 扱い）。
export async function GET(req: NextRequest): Promise<NextResponse> {
  const flow = req.cookies.get("oauth_flow")?.value === "general" ? "general" : "admin";
  const loginPage = flow === "general" ? "/login" : "/admin/login";

  if (flow === "admin" && !adminConfigured()) {
    return NextResponse.redirect(new URL(`${loginPage}?error=not_configured`, appOrigin(req)));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // ユーザーが認可キャンセルした場合
  if (error) {
    return NextResponse.redirect(new URL(`${loginPage}?error=${encodeURIComponent(error)}`, appOrigin(req)));
  }

  if (!code) {
    return NextResponse.redirect(new URL(`${loginPage}?error=missing_code`, appOrigin(req)));
  }

  // state 検証（CSRF 対策）
  const storedState = req.cookies.get("oauth_state")?.value;
  if (!state || !storedState || !timingSafeEqualStr(state, storedState)) {
    return NextResponse.redirect(new URL(`${loginPage}?error=invalid_state`, appOrigin(req)));
  }

  // code_verifier 取得（PKCE）
  const codeVerifier = req.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return NextResponse.redirect(new URL(`${loginPage}?error=missing_verifier`, appOrigin(req)));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_CALLBACK_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL(`${loginPage}?error=not_configured`, appOrigin(req)));
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
      return NextResponse.redirect(new URL(`${loginPage}?error=token_exchange_failed`, appOrigin(req)));
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;

    // ユーザー情報取得
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error("Google userinfo failed:", await userRes.text());
      return NextResponse.redirect(new URL(`${loginPage}?error=userinfo_failed`, appOrigin(req)));
    }

    const userInfo = (await userRes.json()) as GoogleUserInfo;
    const email = userInfo.email?.toLowerCase();

    if (!email || !userInfo.verified_email) {
      console.error("unverified_email:", { email: userInfo.email, verified_email: userInfo.verified_email });
      return NextResponse.redirect(
        new URL(
          `${loginPage}?error=${encodeURIComponent(`unverified_email: ${userInfo.email ?? "(email無し)"}`)}`,
          appOrigin(req)
        )
      );
    }

    let res: NextResponse;

    if (flow === "general") {
      // 見積もり画面：個別に許可されたメールのみログイン可。未許可は申請を記録して通知。
      if (!isAllowedEmail(email)) {
        const isNew = await recordAccessRequest(email, "general");
        if (isNew) await notifyAccessRequest(email, "general");
        return NextResponse.redirect(
          new URL(`${loginPage}?requested=1&email=${encodeURIComponent(email)}`, appOrigin(req))
        );
      }
      const token = await makeUserSessionToken(email);
      if (!token) {
        return NextResponse.redirect(new URL(`${loginPage}?error=session_failed`, appOrigin(req)));
      }
      res = NextResponse.redirect(new URL("/", appOrigin(req)));
      res.cookies.set(USER_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30日（＝以降の再訪問は承認不要）
      });
    } else {
      // 管理画面：個別に許可されたメール→ユーザー名のみログイン可
      const emailsMap = getGoogleEmailsMap();
      const user = emailsMap[email];

      if (!user || !adminUsers()[user]) {
        const isNew = await recordAccessRequest(email, "admin");
        if (isNew) await notifyAccessRequest(email, "admin");
        return NextResponse.redirect(
          new URL(`${loginPage}?requested=1&email=${encodeURIComponent(email)}`, appOrigin(req))
        );
      }

      const token = await makeSessionToken(user);
      if (!token) {
        return NextResponse.redirect(new URL(`${loginPage}?error=session_failed`, appOrigin(req)));
      }
      res = NextResponse.redirect(new URL("/admin", appOrigin(req)));
      res.cookies.set(ADMIN_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12, // 12時間
      });
    }

    // PKCE / flow cookies をクリア
    res.cookies.delete("oauth_code_verifier");
    res.cookies.delete("oauth_state");
    res.cookies.delete("oauth_flow");

    return res;
  } catch (e) {
    console.error("Google callback error:", e);
    return NextResponse.redirect(new URL(`${loginPage}?error=server_error`, appOrigin(req)));
  }
}
