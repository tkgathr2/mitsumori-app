import { describe, it, expect } from "vitest";
import {
  isAllowedEmail,
  makeUserSessionToken,
  verifyUserSessionToken,
  timingSafeEqualStr,
} from "./user-auth";

const ENV = { USER_SESSION_SECRET: "sekret" } as unknown as NodeJS.ProcessEnv;

describe("user-auth", () => {
  it("ドメイン許可: 既定は takagi.bz / stepupnext.com", () => {
    expect(isAllowedEmail("a@takagi.bz", {} as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedEmail("a@stepupnext.com", {} as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedEmail("a@evil.com", {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("ドメイン許可: @を複数含むメールでも末尾ドメインで判定する", () => {
    // split("@")[1] だと "b" になり誤判定するケースの回帰テスト
    expect(isAllowedEmail("a@b@takagi.bz", {} as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedEmail("a@b@evil.com", {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("正しいトークンは検証を通り、メールを復元できる", async () => {
    const token = await makeUserSessionToken("user@takagi.bz", ENV);
    expect(token).not.toBeNull();
    const verified = await verifyUserSessionToken(token, ENV);
    expect(verified).toBe("user@takagi.bz");
  });

  it("許可ドメイン外のメールはトークン発行されない", async () => {
    const token = await makeUserSessionToken("user@evil.com", ENV);
    expect(token).toBeNull();
  });

  it("secret未設定なら発行も検証も必ず失敗する（安全側フェイル）", async () => {
    const token = await makeUserSessionToken("user@takagi.bz", {} as NodeJS.ProcessEnv);
    expect(token).toBeNull();
    const verified = await verifyUserSessionToken("dummy.123.abc", {} as NodeJS.ProcessEnv);
    expect(verified).toBeNull();
  });

  it("期限切れ(30日超過)のトークンは拒否される", async () => {
    const issuedAt = Date.now() - (1000 * 60 * 60 * 24 * 31); // 31日前
    const token = await makeUserSessionToken("user@takagi.bz", ENV, issuedAt);
    expect(token).not.toBeNull();
    const verified = await verifyUserSessionToken(token, ENV);
    expect(verified).toBeNull();
  });

  it("30日以内のトークンはまだ有効", async () => {
    const issuedAt = Date.now() - (1000 * 60 * 60 * 24 * 29); // 29日前
    const token = await makeUserSessionToken("user@takagi.bz", ENV, issuedAt);
    const verified = await verifyUserSessionToken(token, ENV);
    expect(verified).toBe("user@takagi.bz");
  });

  it("改ざんされたトークン(メール差し替え・issuedAt引き伸ばし)は拒否される", async () => {
    const token = await makeUserSessionToken("user@takagi.bz", ENV);
    const [, issuedAtStr, sig] = token!.split(".");
    // issuedAt だけ書き換えて署名は使い回す→検証に落ちるはず
    const tampered = `${Buffer.from("attacker@takagi.bz").toString("base64url")}.${issuedAtStr}.${sig}`;
    const verified = await verifyUserSessionToken(tampered, ENV);
    expect(verified).toBeNull();
  });

  it("timingSafeEqualStr: 長さ違い・内容違いはfalse、同一はtrue", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "ab")).toBe(false);
  });
});
