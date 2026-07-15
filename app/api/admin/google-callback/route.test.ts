import { describe, it, expect } from "vitest";
import { decodeIdTokenClaims, redirectClearingOAuthCookies } from "./route";

function fakeIdToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesignature`;
}

describe("decodeIdTokenClaims", () => {
  it("Google id_token相当のペイロードから email / email_verified を取り出せる", () => {
    const token = fakeIdToken({ email: "user@takagi.bz", email_verified: true, name: "テスト" });
    const claims = decodeIdTokenClaims(token);
    expect(claims).toEqual({ email: "user@takagi.bz", email_verified: true, name: "テスト" });
  });

  it("email_verified が false のペイロードもそのまま反映される", () => {
    const token = fakeIdToken({ email: "user@example.com", email_verified: false });
    const claims = decodeIdTokenClaims(token);
    expect(claims?.email_verified).toBe(false);
  });

  it("不正な形式（.区切りが無い・base64崩れ）は null を返す", () => {
    expect(decodeIdTokenClaims("not-a-jwt")).toBeNull();
    expect(decodeIdTokenClaims("a.b.c".replace("b", "!!!invalid-base64!!!"))).toBeNull();
  });
});

describe("redirectClearingOAuthCookies", () => {
  it("成功・失敗を問わず全returnパスで oauth_code_verifier / oauth_state / oauth_flow を削除する", () => {
    const res = redirectClearingOAuthCookies("https://example.com/login?error=server_error");
    const setCookies = res.headers.getSetCookie();

    for (const name of ["oauth_code_verifier", "oauth_state", "oauth_flow"]) {
      const cookie = setCookies.find((c) => c.startsWith(`${name}=`));
      expect(cookie, `${name} の Set-Cookie が無い`).toBeTruthy();
      // Next.js の cookies().delete() は Expires を過去日時にして即時失効させる
      expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
  });

  it("リダイレクト先URLはそのまま保持する（requested=1等のクエリを壊さない）", () => {
    const res = redirectClearingOAuthCookies("https://example.com/login?requested=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/login?requested=1");
  });
});
