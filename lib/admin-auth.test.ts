import { describe, it, expect } from "vitest";
import {
  adminSecret,
  adminUsers,
  adminConfigured,
  verifyPassword,
  makeSessionToken,
  verifySessionToken,
} from "./admin-auth";

const USERS_JSON = JSON.stringify({ takagi: "pw-takagi", nishimura: "pw-nishimura" });

describe("admin-auth (ユーザー別 v2)", () => {
  it("ADMIN_USERS_JSON からユーザー一覧を読む", () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    expect(adminUsers(env)).toEqual({ takagi: "pw-takagi", nishimura: "pw-nishimura" });
    expect(adminConfigured(env)).toBe(true);
  });

  it("ADMIN_USERS_JSON 未設定なら ADMIN_PASSWORD を admin ユーザーとして扱う", () => {
    const env = { ADMIN_PASSWORD: "pw" } as unknown as NodeJS.ProcessEnv;
    expect(adminUsers(env)).toEqual({ admin: "pw" });
  });

  it("壊れたJSON・不正ユーザー名・空パスワードは無効（誰も入れない側に倒す）", () => {
    expect(
      adminUsers({ ADMIN_USERS_JSON: "{oops" } as unknown as NodeJS.ProcessEnv)
    ).toEqual({});
    expect(
      adminUsers({
        ADMIN_USERS_JSON: JSON.stringify({ "Bad.Name": "x", ok_1: "y", empty: "  " }),
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ ok_1: "y" });
    expect(adminConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("ADMIN_SESSION_SECRET があればそれを secret に使う", () => {
    const env = {
      ADMIN_SESSION_SECRET: "sekret",
      ADMIN_USERS_JSON: USERS_JSON,
    } as unknown as NodeJS.ProcessEnv;
    expect(adminSecret(env)).toBe("sekret");
  });

  it("ADMIN_SESSION_SECRET が無ければユーザー定義由来・どちらも無ければ null", () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    expect(adminSecret(env)).toBe(`session:${USERS_JSON}`);
    expect(adminSecret({ ADMIN_PASSWORD: "pw" } as unknown as NodeJS.ProcessEnv)).toBe(
      "session:pw"
    );
    expect(adminSecret({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("verifyPassword は該当ユーザーのパスワード一致時のみ true", () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    expect(verifyPassword("takagi", "pw-takagi", env)).toBe(true);
    expect(verifyPassword("takagi", "pw-nishimura", env)).toBe(false); // 他人のPWは不可
    expect(verifyPassword("nishimura", "pw-nishimura", env)).toBe(true);
    expect(verifyPassword("unknown", "pw-takagi", env)).toBe(false);
    expect(verifyPassword("takagi", "pw-takagi!", env)).toBe(false); // 長さ違い
  });

  it("makeSessionToken → verifySessionToken でユーザー名が戻る", async () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    const token = await makeSessionToken("takagi", env);
    expect(token).toMatch(/^takagi\.[0-9a-f]{64}$/);
    expect(await verifySessionToken(token, env)).toBe("takagi");
  });

  it("未登録ユーザーのトークンは発行も検証も不可", async () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    expect(await makeSessionToken("ghost", env)).toBeNull();
  });

  it("ユーザー名のすり替え・署名流用は通らない", async () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    const token = (await makeSessionToken("nishimura", env))!;
    const sig = token.split(".")[1];
    expect(await verifySessionToken(`takagi.${sig}`, env)).toBeNull();
  });

  it("secret（パスワード定義）が変わると古いトークンは失効する", async () => {
    const env1 = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    const env2 = {
      ADMIN_USERS_JSON: JSON.stringify({ takagi: "rotated" }),
    } as unknown as NodeJS.ProcessEnv;
    const token = (await makeSessionToken("takagi", env1))!;
    expect(await verifySessionToken(token, env2)).toBeNull();
  });

  it("旧ADMIN_PASSWORD運用（admin）でも一式が動く（後方互換）", async () => {
    const env = { ADMIN_PASSWORD: "secret123" } as unknown as NodeJS.ProcessEnv;
    expect(verifyPassword("admin", "secret123", env)).toBe(true);
    const token = await makeSessionToken("admin", env);
    expect(await verifySessionToken(token, env)).toBe("admin");
  });

  it("空・不正トークンは null", async () => {
    const env = { ADMIN_USERS_JSON: USERS_JSON } as unknown as NodeJS.ProcessEnv;
    expect(await verifySessionToken(undefined, env)).toBeNull();
    expect(await verifySessionToken("", env)).toBeNull();
    expect(await verifySessionToken("deadbeef", env)).toBeNull(); // user区切りなし
    expect(await verifySessionToken(".deadbeef", env)).toBeNull();
    expect(await verifySessionToken("takagi.deadbeef", env)).toBeNull();
  });

  it("secret が無ければ検証は常に null", async () => {
    expect(await verifySessionToken("takagi.aaaa", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(await makeSessionToken("takagi", {} as NodeJS.ProcessEnv)).toBeNull();
  });
});
