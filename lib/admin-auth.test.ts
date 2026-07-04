import { describe, it, expect } from "vitest";
import {
  adminSecret,
  adminPasswordConfigured,
  verifyPassword,
  makeSessionToken,
  verifySessionToken,
} from "./admin-auth";

describe("admin-auth", () => {
  it("ADMIN_SESSION_SECRET があればそれを secret に使う", () => {
    const env = { ADMIN_SESSION_SECRET: "sekret", ADMIN_PASSWORD: "pw" } as unknown as NodeJS.ProcessEnv;
    expect(adminSecret(env)).toBe("sekret");
  });

  it("ADMIN_SESSION_SECRET が無ければ ADMIN_PASSWORD 由来", () => {
    const env = { ADMIN_PASSWORD: "pw" } as unknown as NodeJS.ProcessEnv;
    expect(adminSecret(env)).toBe("session:pw");
  });

  it("どちらも無ければ null", () => {
    expect(adminSecret({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("adminPasswordConfigured は ADMIN_PASSWORD の有無を返す", () => {
    expect(adminPasswordConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      adminPasswordConfigured({ ADMIN_PASSWORD: "x" } as unknown as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      adminPasswordConfigured({ ADMIN_PASSWORD: "  " } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("verifyPassword は一致時のみ true", () => {
    const env = { ADMIN_PASSWORD: "secret123" } as unknown as NodeJS.ProcessEnv;
    expect(verifyPassword("secret123", env)).toBe(true);
    expect(verifyPassword("wrong", env)).toBe(false);
    expect(verifyPassword("secret1234", env)).toBe(false); // 長さ違い
  });

  it("makeSessionToken で作った値は verifySessionToken を通る", async () => {
    const env = { ADMIN_PASSWORD: "secret123" } as unknown as NodeJS.ProcessEnv;
    const token = await makeSessionToken(env);
    expect(token).toBeTruthy();
    expect(await verifySessionToken(token, env)).toBe(true);
  });

  it("secret が変わると古いトークンは失効する", async () => {
    const env1 = { ADMIN_PASSWORD: "old" } as unknown as NodeJS.ProcessEnv;
    const env2 = { ADMIN_PASSWORD: "new" } as unknown as NodeJS.ProcessEnv;
    const token = (await makeSessionToken(env1))!;
    expect(await verifySessionToken(token, env2)).toBe(false);
  });

  it("空・不正トークンは false", async () => {
    const env = { ADMIN_PASSWORD: "secret123" } as unknown as NodeJS.ProcessEnv;
    expect(await verifySessionToken(undefined, env)).toBe(false);
    expect(await verifySessionToken("", env)).toBe(false);
    expect(await verifySessionToken("deadbeef", env)).toBe(false);
  });

  it("secret が無ければ検証は常に false", async () => {
    expect(await verifySessionToken("anything", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(await makeSessionToken({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
