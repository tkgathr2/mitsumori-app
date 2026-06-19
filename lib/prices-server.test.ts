import { describe, it, expect } from "vitest";
import { getPriceData } from "./prices-server";

// 実走の統合テスト：実際の（非公開の）シートに対して getPriceData を呼ぶ。
// SA鍵が無く・公開CSVも401なので、例外を投げずスナップショットへ
// フォールバックすること（落ちても動く）を実ネットワークで確認する。
describe("getPriceData フォールバック（実走）", () => {
  it("鍵なし環境では live:false のスナップショットを返し、会社が揃う", async () => {
    const data = await getPriceData();
    expect(data.live).toBe(false);
    expect(Array.isArray(data.companies)).toBe(true);
    // スナップショットは10社分（西村さんマスタ v3）
    expect(data.companies.length).toBeGreaterThanOrEqual(10);
    // 既知の単価あり会社（株式会社SANJYU A0006）が取れていること
    const sanjyu = data.companies.find((c) => c.code === "A0006");
    expect(sanjyu).toBeDefined();
    expect(sanjyu!.prices.ippan_day).toBe(18000);
    expect(sanjyu!.hasPrice).toBe(true);
  }, 20000);
});
