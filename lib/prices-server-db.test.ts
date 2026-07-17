import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Company } from "./prices";

// getPriceData は「管理画面の単価マスタ（price_companies）だけ」を単価の正とする。
// シート通信（SA直読み／price_cache／公開CSV）は 2026-07-17 に全撤去した。
// ここで固定したいのは「DBが空でもスナップショットの0円単価へ落ちない」こと。

const mockLoad = vi.fn(() => Promise.resolve([] as Company[]));

vi.mock("./price-admin-db", () => ({
  loadCompaniesForPriceData: () => mockLoad(),
}));

function company(code: string, ippanDay: number): Company {
  const prices = {
    ippan_day: ippanDay,
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
  };
  return { code, name: `${code}会社`, prices, hasPrice: ippanDay > 0 };
}

beforeEach(() => {
  vi.resetModules();
  mockLoad.mockReset();
  process.env.DATABASE_URL = "postgres://mock";
});

describe("getPriceData：単価の正は price_companies のみ", () => {
  it("DBの会社をそのまま返し、source は管理画面の単価マスタになる", async () => {
    mockLoad.mockResolvedValue([company("DB1", 30000)]);
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.source).toContain("price_companies");
    expect(data.companies.length).toBe(1);
    expect(data.companies[0].code).toBe("DB1");
    expect(data.companies[0].prices.ippan_day).toBe(30000);
    expect(mockLoad).toHaveBeenCalled();
  });

  it("資器材は静的スナップショットから供給され続ける（シート通信ではないので壊さない）", async () => {
    mockLoad.mockResolvedValue([company("DB1", 30000)]);
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.equipment.length).toBeGreaterThan(0);
    expect(data.equipment[0].price).toBeGreaterThan(0);
  });
});

describe("getPriceData：DBが空でもスナップショットへ落ちない", () => {
  // 【回帰防止の本丸】スナップショットの会社単価は残業単価が0円。
  // フォールバックすると「間違った金額が静かに客先へ出る」ため、空を返すのが正。
  it("DBに会社が無ければ companies は空（スナップショットの0円単価を出さない）", async () => {
    mockLoad.mockResolvedValue([]);
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.companies).toEqual([]);
    expect(data.source).toBe("単価を取得できませんでした");
    // 資器材は静的ファイル由来なので、会社が空でも供給され続ける
    expect(data.equipment.length).toBeGreaterThan(0);
  });

  it("DB接続が落ちても例外を投げず空を返す", async () => {
    mockLoad.mockRejectedValue(new Error("connection refused"));
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.companies).toEqual([]);
  });

  it("DATABASE_URL 未設定なら DB を読みにいかず空を返す", async () => {
    delete process.env.DATABASE_URL;
    const { getPriceData } = await import("./prices-server");
    const data = await getPriceData();
    expect(data.companies).toEqual([]);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  // 空をキャッシュすると一時的なDB断を60秒引きずる。次のリクエストで復帰できること。
  it("空はキャッシュせず、DB復帰後の次リクエストで単価が出る", async () => {
    mockLoad.mockResolvedValueOnce([]).mockResolvedValueOnce([company("DB1", 30000)]);
    const { getPriceData } = await import("./prices-server");
    expect((await getPriceData()).companies).toEqual([]);
    expect((await getPriceData()).companies.length).toBe(1);
  });
});
