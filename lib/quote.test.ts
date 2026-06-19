import { describe, it, expect } from "vitest";
import { lineQuantity, lineAmount, calcTotals, yen, QuoteLine } from "./quote";

describe("lineQuantity", () => {
  it("警備行は 人数×日数", () => {
    expect(
      lineQuantity({ name: "x", unitPrice: 1000, unit: "人日", people: 3, days: 2 })
    ).toBe(6);
  });
  it("片方未入力なら0扱い", () => {
    expect(
      lineQuantity({ name: "x", unitPrice: 1000, unit: "人日", people: 3 })
    ).toBe(0);
  });
  it("自由入力行は qty をそのまま", () => {
    expect(lineQuantity({ name: "機材", unitPrice: 4500, unit: "式", qty: 2 })).toBe(2);
  });
});

describe("lineAmount", () => {
  it("単価×数量", () => {
    expect(
      lineAmount({ name: "昼一般", unitPrice: 18000, unit: "人日", people: 2, days: 3 })
    ).toBe(108000);
  });
  it("数量0なら0", () => {
    expect(lineAmount({ name: "x", unitPrice: 18000, unit: "人日", qty: 0 })).toBe(0);
  });
});

describe("calcTotals", () => {
  it("小計・消費税10%・合計を計算", () => {
    const lines: QuoteLine[] = [
      { name: "昼一般", unitPrice: 18000, unit: "人日", people: 2, days: 3 }, // 108,000
      { name: "カラーコーン", unitPrice: 4500, unit: "式", qty: 2 }, // 9,000
    ];
    const t = calcTotals(lines);
    expect(t.subtotal).toBe(117000);
    expect(t.tax).toBe(11700);
    expect(t.total).toBe(128700);
  });

  it("空配列は全て0", () => {
    const t = calcTotals([]);
    expect(t).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });

  it("消費税の端数は切り捨て", () => {
    // 小計 1,005 → 税 100.5 → 100
    const t = calcTotals([{ name: "x", unitPrice: 1005, unit: "式", qty: 1 }]);
    expect(t.subtotal).toBe(1005);
    expect(t.tax).toBe(100);
    expect(t.total).toBe(1105);
  });

  it("実データ例: SANJYU 夜勤資格者 1名2日 + 遠方", () => {
    const lines: QuoteLine[] = [
      { name: "夜勤資格者", unitPrice: 26250, unit: "人日", people: 1, days: 2 }, // 52,500
      { name: "規制車両費", unitPrice: 30000, unit: "日", qty: 2 }, // 60,000
    ];
    const t = calcTotals(lines);
    expect(t.subtotal).toBe(112500);
    expect(t.tax).toBe(11250);
    expect(t.total).toBe(123750);
  });
});

describe("yen", () => {
  it("桁区切り", () => {
    expect(yen(128700)).toBe("¥128,700");
    expect(yen(0)).toBe("¥0");
  });
});
