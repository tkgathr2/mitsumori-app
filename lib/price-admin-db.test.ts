import { describe, it, expect, vi, beforeEach } from "vitest";

// pg.Pool をモックして、SQL文字列で分岐した擬似応答を返す。
// これで DB層のロジック（CRUD・履歴記録・優先順位）を実DBなしで検証する。

interface QueryCall {
  sql: string;
  params: unknown[];
}
const calls: QueryCall[] = [];
// テストごとに差し替える応答ハンドラ。
let handler: (sql: string, params: unknown[]) => { rows: unknown[] };

vi.mock("pg", () => {
  class Pool {
    query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return Promise.resolve(handler(sql, params));
    }
  }
  return { Pool };
});

// server-only は vitest.config で空モジュール化済み。
import {
  listCompanies,
  createCompany,
  updateRate,
  softDeleteCompany,
  upsertCompanyWithRates,
  hasActiveCompanies,
  loadCompaniesForPriceData,
} from "./price-admin-db";

function has(sub: string): boolean {
  return calls.some((c) => c.sql.includes(sub));
}
function lastMatching(sub: string): QueryCall | undefined {
  return [...calls].reverse().find((c) => c.sql.includes(sub));
}

beforeEach(() => {
  calls.length = 0;
  process.env.DATABASE_URL = "postgres://mock";
  // デフォルト：全クエリ空行。個別テストで上書き。
  handler = () => ({ rows: [] });
});

describe("ensureSchema / listCompanies", () => {
  it("スキーマ作成＋会社0件なら空配列（partial index も作る）", async () => {
    const res = await listCompanies();
    expect(res).toEqual([]);
    expect(has("CREATE TABLE IF NOT EXISTS price_companies")).toBe(true);
    expect(has("price_companies_code_unique")).toBe(true);
    expect(has("WHERE deleted_at IS NULL")).toBe(true);
    expect(has("CREATE TABLE IF NOT EXISTS price_rates")).toBe(true);
    expect(has("CREATE TABLE IF NOT EXISTS price_history")).toBe(true);
  });

  it("会社＋単価を組み立てて返す", async () => {
    handler = (sql) => {
      if (sql.includes("FROM price_companies") && sql.includes("SELECT id, code")) {
        return {
          rows: [
            { id: 1, code: "A1", name: "甲社", note: "備考", sort_order: 0 },
          ],
        };
      }
      if (sql.includes("FROM price_rates")) {
        return {
          rows: [
            { company_id: 1, rate_key: "ippan_day", price: 18000 },
            { company_id: 1, rate_key: "yushi_night", price: 22000 },
            { company_id: 1, rate_key: "bogus_key", price: 999 }, // 未知キーは無視
          ],
        };
      }
      return { rows: [] };
    };
    const res = await listCompanies();
    expect(res.length).toBe(1);
    expect(res[0].name).toBe("甲社");
    expect(res[0].prices.ippan_day).toBe(18000);
    expect(res[0].prices.yushi_night).toBe(22000);
    // 未指定の区分は0
    expect(res[0].prices.ippan_night).toBe(0);
    // 未知キーは Company.prices に混ざらない
    expect((res[0].prices as Record<string, number>).bogus_key).toBeUndefined();
  });
});

describe("createCompany", () => {
  it("会社を作り、12区分の単価行を0初期化する", async () => {
    handler = (sql) => {
      if (sql.includes("INSERT INTO price_companies")) {
        return {
          rows: [{ id: 5, code: "A5", name: "新社", note: "", sort_order: 0 }],
        };
      }
      return { rows: [] };
    };
    const c = await createCompany({ code: "A5", name: "新社" });
    expect(c.id).toBe(5);
    // 単価行を unnest で一括初期化している
    const rateInit = lastMatching("INSERT INTO price_rates");
    expect(rateInit).toBeDefined();
    expect(rateInit!.sql).toContain("unnest");
    // 12区分ぶんのキー配列が渡っている
    const keys = rateInit!.params[1] as string[];
    expect(keys.length).toBe(12);
    expect(keys).toContain("ippan_day");
  });
});

describe("updateRate（履歴記録）", () => {
  it("旧値と異なれば price_history に旧→新を書く", async () => {
    handler = (sql) => {
      if (sql.includes("SELECT name FROM price_companies")) {
        return { rows: [{ name: "甲社" }] };
      }
      if (sql.includes("SELECT price FROM price_rates")) {
        return { rows: [{ price: 18000 }] };
      }
      return { rows: [] };
    };
    await updateRate(1, "ippan_day", 19000, "admin");
    // upsert が走る
    expect(has("ON CONFLICT (company_id, rate_key)")).toBe(true);
    // 履歴に旧→新
    const hist = lastMatching("INSERT INTO price_history");
    expect(hist).toBeDefined();
    expect(hist!.params).toEqual([1, "甲社", "ippan_day", 18000, 19000, "admin"]);
  });

  it("旧値と同じなら履歴を書かない", async () => {
    handler = (sql) => {
      if (sql.includes("SELECT name FROM price_companies")) {
        return { rows: [{ name: "甲社" }] };
      }
      if (sql.includes("SELECT price FROM price_rates")) {
        return { rows: [{ price: 18000 }] };
      }
      return { rows: [] };
    };
    await updateRate(1, "ippan_day", 18000);
    expect(has("INSERT INTO price_history")).toBe(false);
  });

  it("未知の rate_key は弾く", async () => {
    await expect(updateRate(1, "not_a_key", 100)).rejects.toThrow(/rate_key/);
  });

  it("存在しない会社は弾く", async () => {
    handler = (sql) => {
      if (sql.includes("SELECT name FROM price_companies")) return { rows: [] };
      return { rows: [] };
    };
    await expect(updateRate(999, "ippan_day", 100)).rejects.toThrow(/not found/);
  });
});

describe("softDeleteCompany", () => {
  it("deleted_at をセットする UPDATE を打つ", async () => {
    await softDeleteCompany(3);
    const del = lastMatching("SET deleted_at = NOW()");
    expect(del).toBeDefined();
    expect(del!.params).toEqual([3]);
  });
});

describe("upsertCompanyWithRates（seed用）", () => {
  it("同じcodeがあれば更新（created:false）", async () => {
    handler = (sql) => {
      if (sql.includes("SELECT id FROM price_companies WHERE code")) {
        return { rows: [{ id: 7 }] };
      }
      return { rows: [] };
    };
    const r = await upsertCompanyWithRates({
      code: "A1",
      name: "甲社",
      prices: { ippan_day: 18000 },
    });
    expect(r).toEqual({ id: 7, created: false });
    expect(has("UPDATE price_companies")).toBe(true);
    expect(has("INSERT INTO price_companies")).toBe(false);
  });

  it("codeが無ければ新規作成（created:true）", async () => {
    handler = (sql) => {
      if (sql.includes("INSERT INTO price_companies")) {
        return { rows: [{ id: 9 }] };
      }
      return { rows: [] };
    };
    const r = await upsertCompanyWithRates({
      code: "ZZ",
      name: "新社",
      prices: {},
    });
    expect(r).toEqual({ id: 9, created: true });
    // 12区分ぶん upsert する
    const rateUpserts = calls.filter((c) =>
      c.sql.includes("INSERT INTO price_rates")
    );
    expect(rateUpserts.length).toBe(12);
  });
});

describe("hasActiveCompanies / loadCompaniesForPriceData", () => {
  it("生きている会社が0なら false", async () => {
    handler = (sql) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ n: "0" }] };
      return { rows: [] };
    };
    expect(await hasActiveCompanies()).toBe(false);
  });

  it("生きている会社があれば true", async () => {
    handler = (sql) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ n: "3" }] };
      return { rows: [] };
    };
    expect(await hasActiveCompanies()).toBe(true);
  });

  it("DATABASE_URL 未設定なら false", async () => {
    delete process.env.DATABASE_URL;
    expect(await hasActiveCompanies()).toBe(false);
  });

  it("loadCompaniesForPriceData は Company 形（hasPrice計算）で返す", async () => {
    handler = (sql) => {
      if (sql.includes("FROM price_companies") && sql.includes("SELECT id, code")) {
        return {
          rows: [
            { id: 1, code: "A1", name: "甲社", note: "", sort_order: 0 },
            { id: 2, code: "A2", name: "乙社", note: "", sort_order: 1 },
          ],
        };
      }
      if (sql.includes("FROM price_rates")) {
        return { rows: [{ company_id: 1, rate_key: "ippan_day", price: 18000 }] };
      }
      return { rows: [] };
    };
    const cs = await loadCompaniesForPriceData();
    expect(cs.length).toBe(2);
    const kou = cs.find((c) => c.code === "A1")!;
    expect(kou.hasPrice).toBe(true);
    const otsu = cs.find((c) => c.code === "A2")!;
    expect(otsu.hasPrice).toBe(false); // 全区分0
    // 12区分すべてキーが存在
    expect(Object.keys(kou.prices).length).toBe(12);
  });
});
