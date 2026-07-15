import { describe, it, expect } from "vitest";
import { decodeIdTokenClaims } from "./route";

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
