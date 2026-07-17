import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { USER_COOKIE, verifyUserSessionToken } from "@/lib/user-auth";

// /admin（loginを除く）と /api/admin/* を保護する。
//   ・未ログインで /admin → /admin/login へリダイレクト
//   ・未ログインで /api/admin → 401 JSON
// 見積もり画面（トップページ "/"）も同様に保護する。
//   ・未ログインで "/" → /login へリダイレクト
//   ・一度ログインすればセッションCookie(30日)が続く限り再承認は不要
// 認証は cookie の HMAC 署名を検証するだけ（ステートレス）。

async function isAdminAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  return (await verifySessionToken(token)) !== null;
}

async function isUserAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(USER_COOKIE)?.value;
  return (await verifyUserSessionToken(token)) !== null;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ログイン系・OAuthコールバックは常に通す（未ログイン状態で叩く経路のため）。
  //
  // 【M2M窓口の除外ルール】cookie を持たない呼び出し元（cron・curl 等）が叩く
  // エンドポイントは、route 内で x-api-key を検証する前提で cookie ゲートから除外する。
  // ここに漏れがあると「route の認証は正しいのに middleware が先に 401 を返す」＝
  // 認証が壊れたのではなく経路が死ぬ、という気づきにくい障害になる。
  // ※ 単価同期のM2M窓口（/api/admin/seed・/api/prices/update）は、シート通信の全撤去
  //    （2026-07-17 社長決定）で route ごと削除したため、この除外リストからも外した。
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout" ||
    pathname === "/api/admin/google-login" ||
    pathname === "/api/admin/google-callback" ||
    pathname === "/login" ||
    pathname === "/api/login/google-login"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    if (!(await isAdminAuthed(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!(await isAdminAuthed(req))) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 見積もり画面（トップページ）本体・および見積もり画面が使うデータAPI
  // （単価・見積履歴・MF連携）。ページだけでなくAPIも同じログインで保護する
  // （バグチェックlab指摘：APIがmiddleware対象外で未ログイン素通りだった）。
  const isEstimateApi =
    pathname.startsWith("/api/quotes") ||
    pathname.startsWith("/api/prices") ||
    pathname.startsWith("/api/mf-quote") ||
    pathname.startsWith("/api/mf-auth") ||
    pathname.startsWith("/api/mf-callback");

  if (isEstimateApi) {
    if ((await isUserAuthed(req)) || (await isAdminAuthed(req))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === "/") {
    if ((await isUserAuthed(req)) || (await isAdminAuthed(req))) {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/quotes/:path*",
    "/api/prices/:path*",
    "/api/mf-quote/:path*",
    "/api/mf-auth/:path*",
    "/api/mf-callback/:path*",
  ],
};
