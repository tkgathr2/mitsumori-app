import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadTokens,
  isDbConfigured,
  isKvConfigured,
} from "./mf-tokens";

// DATABASE_URL 未設定（=DBなし）の状態で env ブートストラップ経路を検証する。
// 実DBへの読み書きは本番ヘルスチェックで実証する（ここでは単体ロジックのみ）。
describe("mf-tokens (DBなし・envブートストラップ)", () => {
  const origDb = process.env.DATABASE_URL;
  const origRefresh = process.env.MF_REFRESH_TOKEN;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.MF_REFRESH_TOKEN;
  });
  afterEach(() => {
    if (origDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = origDb;
    if (origRefresh === undefined) delete process.env.MF_REFRESH_TOKEN;
    else process.env.MF_REFRESH_TOKEN = origRefresh;
  });

  it("DATABASE_URL も MF_REFRESH_TOKEN も無ければ null", async () => {
    expect(await loadTokens()).toBeNull();
  });

  it("MF_REFRESH_TOKEN があればそれをブートストラップ値として返す", async () => {
    process.env.MF_REFRESH_TOKEN = "seed-refresh-token";
    const rec = await loadTokens();
    expect(rec).not.toBeNull();
    expect(rec!.refresh_token).toBe("seed-refresh-token");
    // access_token は空・期限切れ扱い → 必ず refresh が走る
    expect(rec!.access_token).toBe("");
    expect(rec!.access_expires_at).toBe(0);
  });

  it("isDbConfigured / isKvConfigured は DATABASE_URL の有無を反映する", () => {
    delete process.env.DATABASE_URL;
    expect(isDbConfigured()).toBe(false);
    expect(isKvConfigured()).toBe(false);
    process.env.DATABASE_URL = "postgres://x";
    expect(isDbConfigured()).toBe(true);
    // 後方互換: isKvConfigured は「永続化ストレージが構成済みか」を返す
    expect(isKvConfigured()).toBe(true);
  });
});
