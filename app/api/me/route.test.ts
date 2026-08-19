import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { USER_COOKIE, makeUserSessionToken } from "@/lib/user-auth";
import { ADMIN_COOKIE, makeSessionToken } from "@/lib/admin-auth";

const ORIGINAL_ENV = { ...process.env };

function reqWithCookie(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/me", {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/me", () => {
  beforeEach(() => {
    process.env.USER_SESSION_SECRET = "sekret";
    process.env.ALLOWED_USER_EMAILS = "user@takagi.bz";
    process.env.ADMIN_USERS_JSON = JSON.stringify({ takagi: "pw1" });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("user Cookieが有効ならメールアドレスを返す（no-store付き）", async () => {
    const token = await makeUserSessionToken("user@takagi.bz");
    const res = await GET(reqWithCookie(`${USER_COOKIE}=${token}`));
    const body = await res.json();
    expect(body).toEqual({ user: "user@takagi.bz" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("user Cookieが無くadmin Cookieが有効なら「ユーザー名（管理画面）」を返す", async () => {
    const token = await makeSessionToken("takagi");
    const res = await GET(reqWithCookie(`${ADMIN_COOKIE}=${token}`));
    const body = await res.json();
    expect(body).toEqual({ user: "takagi（管理画面）" });
  });

  it("user Cookieが優先される（両方有効な場合）", async () => {
    const userToken = await makeUserSessionToken("user@takagi.bz");
    const adminToken = await makeSessionToken("takagi");
    const res = await GET(
      reqWithCookie(`${USER_COOKIE}=${userToken}; ${ADMIN_COOKIE}=${adminToken}`)
    );
    const body = await res.json();
    expect(body).toEqual({ user: "user@takagi.bz" });
  });

  it("どちらのCookieも無効/無しなら200 + user:null", async () => {
    const res = await GET(reqWithCookie(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });

  it("期限切れのuser Cookieはnullとして扱われる（admin Cookieがあればそちらを見る）", async () => {
    const issuedAt = Date.now() - 1000 * 60 * 60 * 24 * 31; // 31日前
    const expiredToken = await makeUserSessionToken("user@takagi.bz", process.env, issuedAt);
    const res = await GET(reqWithCookie(`${USER_COOKIE}=${expiredToken}`));
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });
});
