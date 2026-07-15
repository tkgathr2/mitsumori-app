import { describe, it, expect } from "vitest";
import {
  isAllowedEmail,
  makeUserSessionToken,
  verifyUserSessionToken,
  timingSafeEqualStr,
} from "./user-auth";

const ENV = {
  USER_SESSION_SECRET: "sekret",
  ALLOWED_USER_EMAILS: "user@takagi.bz,west@stepupnext.com",
} as unknown as NodeJS.ProcessEnv;

describe("user-auth", () => {
  it("個別許可: ALLOWED_USER_EMAILS に載っているメールだけ許可", () => {
    expect(isAllowedEmail("user@takagi.bz", ENV)).toBe(true);
    expect(isAllowedEmail("West@Stepupnext.com", ENV)).toBe(true); // 大文字小文字を無視
    expect(isAllowedEmail("other@takagi.bz", ENV)).toBe(false); // 同ドメインでも未許可なら弾く
  });

  it("個別許可: ALLOWED_USER_EMAILS 未設定なら誰も許可しない（安全側に倒す）", () => {
    expect(isAllowedEmail("user@takagi.bz", {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("正しいトークンは検証を通り、メールを復元できる", async () => {
    const token = await makeUserSessionToken("user@takagi.bz", ENV);
    expect(token).not.toBeNull();
    const verified = await verifyUserSessionToken(token, ENV);
    expect(verified).toBe("user@takagi.bz");
  });

  it("許可リスト外のメールはトークン発行されない", async () => {
    const token = await makeUserSessionToken("other@takagi.bz", ENV);
    expect(token).toBeNull();
  });

  it("secret未設定なら発行も検証も必ず失敗する（安全側フェイル）", async () => {
    const token = await makeUserSessionToken("user@takagi.bz", { ALLOWED_USER_EMAILS: "user@takagi.bz" } as unknown as NodeJS.ProcessEnv);
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
