import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Company } from "./prices";

// getPriceData の「①管理DB優先 → ②フォールバック」を検証する。
// price-admin-db をモックし、DBに会社がある/ない両方をテスト。

const mockHasActive = vi.fn(() => Promise.resolve(false));
const mockLoad = vi.fn(() => Promise.resolve([] as Company[]));

vi.mock("./price-admin-db", () => ({
  hasActiveCompanies: () => mockHasActive(),
  loadCompaniesForPriceData: () => mockLoad(),
}));

beforeEach(() => {
  vi.resetModules();
  mockHasActive.mockReset();
  mockLoad.mockReset();
  process.env.DATABASE_URL = "postgres://mock";
});

describe("getPriceData：DB優先", () => {
  it("DBに生きた会社があれば DB を source にして返す", async () => {
    mockHasActive.mockResolvedValue(true);
    mockLoad.mockResolvedValue([
      {
        code: "DB1",
        name: "DB会社",
        prices: {
          ippan_day: 30000,
          ippan_day_ot: 0,
          ippan_night: 0,
          ippan_night_ot: 0,
          ippan_holiday: 0,
          ippan_holiday_ot: 0,
          yushi_day: 0,
          yushi_day_ot: 0,
          yushi_night: 0,
          yushi_night_ot: 0,
          yushi_holiday: 0,
          yushi_holiday_ot: 0,
        },
        hasPrice: true,
      },
    ]);
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.source).toBe("DB (price_companies)");
    expect(data.live).toBe(true);
    expect(data.companies.length).toBe(1);
    expect(data.companies[0].code).toBe("DB1");
    expect(data.companies[0].prices.ippan_day).toBe(30000);
    // ライブ取得（シート）には行っていない＝loadは呼ばれた
    expect(mockLoad).toHaveBeenCalled();
  });
});

describe("getPriceData：DBが空ならフォールバック", () => {
  it("DBに会社が無ければスナップショット（live:false）へ", async () => {
    // DBキャッシュ経路が実接続を試みないよう DATABASE_URL を外す。
    // （tryFetchFromAdminDb は URL 未設定で null を返すので mockLoad は呼ばれない想定）
    delete process.env.DATABASE_URL;
    mockHasActive.mockResolvedValue(false);
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    // SA鍵なし・公開CSV不可の環境なので snapshot(false)
    expect(data.source).not.toBe("DB (price_companies)");
    expect(data.live).toBe(false);
    expect(Array.isArray(data.companies)).toBe(true);
    expect(data.companies.length).toBeGreaterThanOrEqual(10);
    expect(mockLoad).not.toHaveBeenCalled();
  }, 20000);
});
