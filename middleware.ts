import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";

// /admin（loginを除く）と /api/admin/* を保護する。
//   ・未ログインで /admin → /admin/login へリダイレクト
//   ・未ログインで /api/admin → 401 JSON
// 認証は cookie の HMAC 署名を検証するだけ（ステートレス）。

async function isAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ログイン系は常に通す（ページ・ログイン/ログアウトAPI）。
  // seed は route 内で x-api-key（ADMIN_PASSWORD / PRICE_SYNC_SECRET）認証するため
  // middleware のcookieゲートからは除外し、curl等から叩けるようにする。
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout" ||
    pathname === "/api/admin/seed"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    if (!(await isAuthed(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!(await isAuthed(req))) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
