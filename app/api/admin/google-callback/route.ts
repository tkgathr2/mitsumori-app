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

// OIDC ID token（JWT）のクレーム。email_verified はOIDC Core仕様で定義済み。
type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean;
  name?: string;
};

// id_token（JWT: header.payload.signature）の payload 部分だけをデコードする。
// 署名検証はしない（token交換自体がHTTPS+client_secretでGoogleと直接通信済みのため、
// 経路上での改ざんリスクは無い＝Authorization Code Flowにおける標準的な信頼範囲）。
export function decodeIdTokenClaims(idToken: string): GoogleUserInfo | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as GoogleUserInfo;
  } catch {
    return null;
  }
}

// Railway等のリバースプロキシ配下では req.url がコンテナ内部のホスト(localhost:8080等)を
// 指すことがあるため、redirect先の組み立ては x-forwarded-host / x-forwarded-proto を優先する。
function appOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

// PKCE / flow cookies は成功・失敗を問わず必ずクリアする。
// oauth_state はワンショットのはずなので、失敗パスで残り続けると同一 state が
// 有効期限（10分）内ずっと検証を通ってしまう。新しい return を足すたびに消し忘れる
// リスクを減らすため、redirect 生成はすべてこのヘルパーを経由させる。
export function redirectClearingOAuthCookies(url: string | URL): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.delete("oauth_code_verifier");
  res.cookies.delete("oauth_state");
  res.cookies.delete("oauth_flow");
  return res;
}

// 申請の記録(recordAccessRequest)と通知(notifyAccessRequest)を、それぞれ独立してtry/catchする。
// どちらかがDB例外等で失敗しても、呼び出し元(GETハンドラの外側try/catch)まで例外を伝播させない。
// 記録が失敗した場合は「新規かどうか」を判定できないが、通知漏れの方が実害が大きいため
// 通知は試みる（＝isNew不明時はtrue扱い）。逆に通知が失敗しても記録の成否には影響しない。
async function requestAccess(email: string, flow: "admin" | "general"): Promise<void> {
  let isNew = true;
  try {
    isNew = await recordAccessRequest(email, flow);
  } catch (e) {
    console.error("recordAccessRequest failed:", e);
  }
  try {
    if (isNew) await notifyAccessRequest(email, flow);
  } catch (e) {
    console.error("notifyAccessRequest failed:", e);
  }
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
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=not_configured`, appOrigin(req)));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // ユーザーが認可キャンセルした場合
  if (error) {
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=${encodeURIComponent(error)}`, appOrigin(req)));
  }

  if (!code) {
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=missing_code`, appOrigin(req)));
  }

  // state 検証（CSRF 対策）
  const storedState = req.cookies.get("oauth_state")?.value;
  if (!state || !storedState || !timingSafeEqualStr(state, storedState)) {
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=invalid_state`, appOrigin(req)));
  }

  // code_verifier 取得（PKCE）
  const codeVerifier = req.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=missing_verifier`, appOrigin(req)));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_CALLBACK_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=not_configured`, appOrigin(req)));
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
      return redirectClearingOAuthCookies(new URL(`${loginPage}?error=token_exchange_failed`, appOrigin(req)));
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;

    // id_token（JWT）のペイロードを直接デコードしてクレームを取る。
    // userinfoエンドポイントは v2/v3 でフィールド名（verified_email / email_verified）が違い
    // 取り違えると常に未検証扱いになる事故が起きるため、OIDC仕様で email_verified が
    // 定義済みの id_token を信頼できる情報源として使う（token交換はHTTPS+client_secretで
    // 直接Googleと通信しているため署名検証なしでも十分信頼できる）。
    const userInfo = tokenData.id_token ? decodeIdTokenClaims(tokenData.id_token) : null;
    if (!userInfo) {
      console.error("id_token decode failed");
      return redirectClearingOAuthCookies(new URL(`${loginPage}?error=userinfo_failed`, appOrigin(req)));
    }
    const email = userInfo.email?.toLowerCase();

    if (!email || !userInfo.email_verified) {
      // PIIをログに残さない：真偽値のみ（メールアドレス自体は出力しない）
      console.error("unverified_email:", { email_verified: userInfo.email_verified });
      return redirectClearingOAuthCookies(
        new URL(
          `${loginPage}?error=${encodeURIComponent("メールアドレスが確認できませんでした")}`,
          appOrigin(req)
        )
      );
    }

    let res: NextResponse;

    if (flow === "general") {
      // 見積もり画面：個別に許可されたメールのみログイン可。未許可は申請を記録して通知。
      if (!isAllowedEmail(email)) {
        await requestAccess(email, "general");
        return redirectClearingOAuthCookies(new URL(`${loginPage}?requested=1`, appOrigin(req)));
      }
      const token = await makeUserSessionToken(email);
      if (!token) {
        return redirectClearingOAuthCookies(new URL(`${loginPage}?error=session_failed`, appOrigin(req)));
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
        await requestAccess(email, "admin");
        return redirectClearingOAuthCookies(new URL(`${loginPage}?requested=1`, appOrigin(req)));
      }

      const token = await makeSessionToken(user);
      if (!token) {
        return redirectClearingOAuthCookies(new URL(`${loginPage}?error=session_failed`, appOrigin(req)));
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
    return redirectClearingOAuthCookies(new URL(`${loginPage}?error=server_error`, appOrigin(req)));
  }
}
