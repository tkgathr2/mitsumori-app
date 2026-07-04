import { describe, it, expect } from "vitest";
import { parseSeedCsv, parseSeedJson } from "./seed-parse";

// 12単価の順（一般6＋有資格6）。
const HDR_FIXED =
  "No,会社コード,会社名,一般昼,一般昼残,一般夜,一般夜残,一般休,一般休残,有資格昼,有資格昼残,有資格夜,有資格夜残,有資格休,有資格休残";

describe("parseSeedCsv（固定列順・v3互換）", () => {
  it("No始まりのデータ行を会社として読む", () => {
    const csv =
      HDR_FIXED +
      "\n1,A0001,テスト警備,18000,2000,20000,2500,24000,3000,20000,2200,22000,2700,26000,3200";
    const rows = parseSeedCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe("A0001");
    expect(rows[0].name).toBe("テスト警備");
    expect(rows[0].prices.ippan_day).toBe(18000);
    expect(rows[0].prices.yushi_holiday_ot).toBe(3200);
  });

  it("カンマ入り金額・空行を無視して読む", () => {
    const csv =
      HDR_FIXED +
      '\n1,A0002,"カンマ, 商事","18,000",0,0,0,0,0,0,0,0,0,0,0\n\n';
    const rows = parseSeedCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("カンマ, 商事");
    expect(rows[0].prices.ippan_day).toBe(18000);
  });
});

describe("parseSeedCsv（ヘッダ駆動・列順が違う）", () => {
  it("会社名/会社コード/備考をヘッダから特定する", () => {
    // 備考列がコード・名前の後、単価はその次から。
    const csv =
      "会社コード,会社名,備考,一般昼,一般昼残,一般夜,一般夜残,一般休,一般休残,有資格昼,有資格昼残,有資格夜,有資格夜残,有資格休,有資格休残\n" +
      "B0001,ヘッダ警備,主要取引先,15000,1800,17000,2000,20000,2400,17000,2000,19000,2300,23000,2800";
    const rows = parseSeedCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe("B0001");
    expect(rows[0].name).toBe("ヘッダ警備");
    expect(rows[0].note).toBe("主要取引先");
    expect(rows[0].prices.ippan_day).toBe(15000);
    expect(rows[0].prices.yushi_holiday_ot).toBe(2800);
  });
});

describe("parseSeedJson", () => {
  it("name/code/note/prices を柔軟に拾う", () => {
    const rows = parseSeedJson([
      {
        code: "C0001",
        name: "JSON警備",
        note: "テスト",
        prices: { ippan_day: 12000, yushi_night: 15000 },
      },
      { 会社名: "日本語キー", 会社コード: "C0002", 備考: "メモ" },
      { name: "" }, // 名前空はスキップ
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("JSON警備");
    expect(rows[0].prices.ippan_day).toBe(12000);
    expect(rows[0].prices.ippan_night).toBe(0); // 未指定は0
    expect(rows[1].name).toBe("日本語キー");
    expect(rows[1].code).toBe("C0002");
    expect(rows[1].note).toBe("メモ");
  });
});
