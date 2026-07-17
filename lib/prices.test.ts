import { describe, it, expect } from "vitest";
import {
  snapshotData,
  sortCompanies,
  RATE_DEFS,
  type Company,
} from "./prices";

// スナップショット（静的ファイル）は資器材の供給元としてだけ残す。
// 会社単価は残業が0円で、単価の正ではない（＝型としても持たせない）。
describe("snapshotData", () => {
  it("資器材を返す（見積画面の資器材はここが供給元）", () => {
    const meta = snapshotData();
    expect(meta.equipment.length).toBeGreaterThan(0);
    expect(meta.equipment[0].price).toBeGreaterThan(0);
    expect(meta.capturedAt).toBeTruthy();
  });

  it("会社（0円単価を含むスナップショット）は返さない", () => {
    expect(snapshotData()).not.toHaveProperty("companies");
  });
});

describe("sortCompanies", () => {
  const mk = (name: string, hasPrice: boolean): Company => ({
    code: name,
    name,
    prices: RATE_DEFS.reduce(
      (acc, d) => ({ ...acc, [d.key]: hasPrice ? 18000 : 0 }),
      {} as Company["prices"]
    ),
    hasPrice,
  });

  it("単価ありの会社が先頭、その中は名前順", () => {
    const list = [
      mk("あ社（無）", false),
      mk("う社（有）", true),
      mk("い社（有）", true),
    ];
    const sorted = sortCompanies(list).map((c) => c.name);
    expect(sorted[0]).toBe("い社（有）");
    expect(sorted[1]).toBe("う社（有）");
    expect(sorted[2]).toBe("あ社（無）");
  });
});
