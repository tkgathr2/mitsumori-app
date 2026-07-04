import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuoteLine } from "./quote";

// mf-client と mf-oauth をモックして、createMfQuote が
// 正しいMFリクエストを組み立てるかを検証する。
const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  ensurePartnerDepartment: vi.fn(),
  getValidAccessToken: vi.fn(),
  oauthConfigured: vi.fn(),
}));

vi.mock("./mf-client", () => ({
  createQuote: mocks.createQuote,
  ensurePartnerDepartment: mocks.ensurePartnerDepartment,
}));
vi.mock("./mf-oauth", () => ({
  getValidAccessToken: mocks.getValidAccessToken,
  oauthConfigured: mocks.oauthConfigured,
}));

import { createMfQuote } from "./mf";
import { calcTotals } from "./quote";

const lines: QuoteLine[] = [
  { name: "昼一般", unitPrice: 18000, unit: "人日", people: 2, days: 3 }, // qty 6
  { name: "カラーコーン", unitPrice: 4500, unit: "式", qty: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.oauthConfigured.mockReturnValue(true);
  mocks.getValidAccessToken.mockResolvedValue("tok_abc");
  mocks.ensurePartnerDepartment.mockResolvedValue({
    partner: { id: "p1", name: "日本交通誘導" },
    departmentId: "dep_1",
  });
  mocks.createQuote.mockResolvedValue({
    id: "q_1",
    quote_number: "0001",
    pdf_url: "https://invoice.moneyforward.com/api/v3/quotes/q_1.pdf",
  });
});

describe("createMfQuote", () => {
  it("未設定なら stub で安全に返す", async () => {
    mocks.oauthConfigured.mockReturnValue(false);
    const r = await createMfQuote({
      companyName: "X",
      lines,
      totals: calcTotals(lines),
    });
    expect(r.ok).toBe(false);
    expect(r.stub).toBe(true);
  });

  it("未連携(tokenなし)なら OAuth誘導の stub", async () => {
    mocks.getValidAccessToken.mockResolvedValue(null);
    const r = await createMfQuote({
      companyName: "X",
      lines,
      totals: calcTotals(lines),
    });
    expect(r.ok).toBe(false);
    expect(r.stub).toBe(true);
    expect(r.message).toContain("mf-auth");
  });

  it("明細を MF item に変換し excise=ten_percent で作成する", async () => {
    const r = await createMfQuote({
      companyName: "株式会社日本交通誘導",
      lines,
      totals: calcTotals(lines),
    });
    expect(r.ok).toBe(true);
    expect(r.quoteId).toBe("q_1");
    expect(r.quoteNumber).toBe("0001");
    expect(r.pdfUrl).toContain("/quotes/q_1.pdf");

    // ensurePartnerDepartment は会社名で呼ばれる
    expect(mocks.ensurePartnerDepartment).toHaveBeenCalledWith(
      "株式会社日本交通誘導",
      "tok_abc"
    );

    // createQuote の引数を検証
    const [arg] = mocks.createQuote.mock.calls[0];
    expect(arg.department_id).toBe("dep_1");
    expect(arg.items).toHaveLength(2);
    expect(arg.items[0]).toMatchObject({
      name: "昼一般",
      price: 18000,
      quantity: 6,
      excise: "ten_percent",
    });
    expect(arg.items[1]).toMatchObject({
      name: "カラーコーン",
      price: 4500,
      quantity: 2,
      excise: "ten_percent",
    });
    // 日付は YYYY-MM-DD
    expect(arg.quote_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.expired_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("単価を手動上書きした行は、上書き後の単価がMF明細にそのまま渡る", async () => {
    // UI側で resolveUnitPrice(autoPrice, overridePrice) が解決した後の
    // QuoteLine を想定（overridePrice=20000 が unitPrice に反映済み）。
    const overriddenLines: QuoteLine[] = [
      { name: "昼一般", unitPrice: 20000, unit: "人日", people: 2, days: 3 }, // 元は18000だが上書き
    ];
    await createMfQuote({
      companyName: "株式会社日本交通誘導",
      lines: overriddenLines,
      totals: calcTotals(overriddenLines),
    });
    const [arg] = mocks.createQuote.mock.calls[0];
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0]).toMatchObject({
      name: "昼一般",
      price: 20000, // 上書き後の単価がMF側にそのまま渡る
      quantity: 6,
      excise: "ten_percent",
    });
  });

  it("金額0の行は除外する", async () => {
    const withZero: QuoteLine[] = [
      ...lines,
      { name: "空行", unitPrice: 0, unit: "式", qty: 0 },
    ];
    await createMfQuote({
      companyName: "X",
      lines: withZero,
      totals: calcTotals(withZero),
    });
    const [arg] = mocks.createQuote.mock.calls[0];
    expect(arg.items).toHaveLength(2);
  });
});
