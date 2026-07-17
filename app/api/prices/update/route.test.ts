import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// DB層（lib/price-admin-db）ごとモックする。pg にも DATABASE_URL にも触れないので、
// 本番DBへ接続する経路がそもそも存在しない。
const listCompanies = vi.fn();
const updateRate = vi.fn();
const upsertCompanyWithRates = vi.fn();

vi.mock("@/lib/price-admin-db", () => ({
  listCompanies: () => listCompanies(),
  updateRate: (...a: unknown[]) => updateRate(...a),
  upsertCompanyWithRates: (...a: unknown[]) => upsertCompanyWithRates(...a),
}));

import { POST } from "./route";

const SECRET = "test-secret";

function emptyPrices(): Record<string, number> {
  return {
    ippan_day: 0,
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
}

function post(body: unknown, apiKey: string | null = SECRET): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey !== null) headers["x-api-key"] = apiKey;
  return new NextRequest(new URL("https://mitsumori.takagi.bz/api/prices/update"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PRICE_SYNC_SECRET = SECRET;
  listCompanies.mockResolvedValue([]);
  updateRate.mockResolvedValue(undefined);
  upsertCompanyWithRates.mockResolvedValue({ id: 1, created: true });
});

describe("認証・入力バリデーション（既存挙動の維持）", () => {
  it("x-api-key が無ければ401", async () => {
    const res = await POST(post({ companies: [] }, null));
    expect(res.status).toBe(401);
    expect(listCompanies).not.toHaveBeenCalled();
  });

  it("x-api-key が不正なら401", async () => {
    const res = await POST(post({ companies: [] }, "wrong"));
    expect(res.status).toBe(401);
    expect(upsertCompanyWithRates).not.toHaveBeenCalled();
  });

  it("companies が空配列なら400", async () => {
    const res = await POST(post({ companies: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "companies required" });
  });

  it("companies が無ければ400", async () => {
    const res = await POST(post({ source: "sheet" }));
    expect(res.status).toBe(400);
  });
});

describe("hasPrice:false のスキップ（既存データ破壊の防止）", () => {
  it("hasPrice:false の会社は書き込み関数を一切呼ばない", async () => {
    // 既にDBに単価が入っている会社が、シート側は空欄で来たケース。
    listCompanies.mockResolvedValue([
      { id: 7, code: "A1", name: "甲社", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 18000 } },
    ]);

    const res = await POST(
      post({
        companies: [{ code: "A1", name: "甲社", prices: emptyPrices(), hasPrice: false }],
      })
    );

    expect(res.status).toBe(200);
    // 0で上書きされない＝既存の18000が守られる
    expect(updateRate).not.toHaveBeenCalled();
    expect(upsertCompanyWithRates).not.toHaveBeenCalled();

    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.skippedCodes).toEqual(["A1"]);
    expect(json.changedRates).toBe(0);
  });

  it("hasPrice:false の未知の会社は新規作成もしない", async () => {
    const res = await POST(
      post({
        companies: [{ code: "NEW", name: "新社", prices: emptyPrices(), hasPrice: false }],
      })
    );

    expect(upsertCompanyWithRates).not.toHaveBeenCalled();
    expect((await res.json()).created).toBe(0);
  });

  it("code が無い会社もスキップする（同定できず毎回新規作成になるため）", async () => {
    const res = await POST(
      post({
        companies: [{ code: "", name: "名前だけの社", prices: { ippan_day: 100 }, hasPrice: true }],
      })
    );

    expect(upsertCompanyWithRates).not.toHaveBeenCalled();
    expect(updateRate).not.toHaveBeenCalled();
    expect((await res.json()).skipped).toBe(1);
  });

  it("同じペイロード内で有効な会社とスキップ対象が混在しても、有効な方だけ処理する", async () => {
    const res = await POST(
      post({
        companies: [
          { code: "A1", name: "甲社", prices: { ...emptyPrices(), ippan_day: 18000 }, hasPrice: true },
          { code: "A2", name: "乙社", prices: emptyPrices(), hasPrice: false },
        ],
      })
    );

    expect(upsertCompanyWithRates).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(1);
    expect(json.skippedCodes).toEqual(["A2"]);
  });
});

describe("新規会社は upsertCompanyWithRates で作成", () => {
  it("DBに無い code は正しい引数で upsertCompanyWithRates を呼ぶ", async () => {
    listCompanies.mockResolvedValue([]);

    await POST(
      post({
        companies: [
          { code: "A1", name: "甲社", prices: { ippan_day: 18000, yushi_night: 22000 }, hasPrice: true },
        ],
      })
    );

    expect(upsertCompanyWithRates).toHaveBeenCalledTimes(1);
    expect(upsertCompanyWithRates).toHaveBeenCalledWith({
      code: "A1",
      name: "甲社",
      // 12区分すべてが埋まった状態で渡る（未指定は0）
      prices: { ...emptyPrices(), ippan_day: 18000, yushi_night: 22000 },
    });
  });

  it("会社の同定は名前ではなく code で行う（名前が変わっても新規作成しない）", async () => {
    listCompanies.mockResolvedValue([
      { id: 7, code: "A1", name: "甲社（旧称）", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 18000 } },
    ]);

    await POST(
      post({
        companies: [
          { code: "A1", name: "甲社（新称）", prices: { ...emptyPrices(), ippan_day: 19000 }, hasPrice: true },
        ],
      })
    );

    expect(upsertCompanyWithRates).not.toHaveBeenCalled();
    expect(updateRate).toHaveBeenCalledWith(7, "ippan_day", 19000, "gas-sync");
  });

  it("不正な単価値（文字列・負値・欠損）は0に正規化される", async () => {
    await POST(
      post({
        companies: [
          {
            code: "A1",
            name: "甲社",
            prices: { ippan_day: 18000, ippan_night: -500, yushi_day: "abc" as unknown as number },
            hasPrice: true,
          },
        ],
      })
    );

    expect(upsertCompanyWithRates).toHaveBeenCalledWith({
      code: "A1",
      name: "甲社",
      prices: { ...emptyPrices(), ippan_day: 18000 },
    });
  });
});

describe("既存会社は差分のある区分だけ updateRate（履歴に gas-sync が残る）", () => {
  it("変わった区分だけを changedBy=gas-sync で更新する", async () => {
    listCompanies.mockResolvedValue([
      {
        id: 7,
        code: "A1",
        name: "甲社",
        note: "",
        sortOrder: 0,
        prices: { ...emptyPrices(), ippan_day: 18000, yushi_night: 22000 },
      },
    ]);

    const res = await POST(
      post({
        companies: [
          {
            code: "A1",
            name: "甲社",
            // ippan_day だけ変更、yushi_night は据え置き
            prices: { ...emptyPrices(), ippan_day: 19000, yushi_night: 22000 },
            hasPrice: true,
          },
        ],
      })
    );

    expect(updateRate).toHaveBeenCalledTimes(1);
    expect(updateRate).toHaveBeenCalledWith(7, "ippan_day", 19000, "gas-sync");

    const json = await res.json();
    expect(json.updated).toBe(1);
    expect(json.created).toBe(0);
    expect(json.changedRates).toBe(1);
  });

  it("シート側で単価が下がった場合も追従する（シートが正）", async () => {
    listCompanies.mockResolvedValue([
      { id: 7, code: "A1", name: "甲社", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 20000 } },
    ]);

    await POST(
      post({
        companies: [
          { code: "A1", name: "甲社", prices: { ...emptyPrices(), ippan_day: 18000 }, hasPrice: true },
        ],
      })
    );

    expect(updateRate).toHaveBeenCalledWith(7, "ippan_day", 18000, "gas-sync");
  });
});

describe("冪等性", () => {
  it("同じペイロードを2回POSTしても、2回目は1件も書き込まない", async () => {
    const dbState = [
      { id: 7, code: "A1", name: "甲社", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 18000 } },
    ];
    listCompanies.mockResolvedValue(dbState);

    const payload = {
      companies: [
        { code: "A1", name: "甲社", prices: { ...emptyPrices(), ippan_day: 18000 }, hasPrice: true },
      ],
    };

    const res1 = await POST(post(payload));
    const json1 = await res1.json();
    // 1回目からして差分ゼロ（DBが既にシートと一致）
    expect(updateRate).not.toHaveBeenCalled();
    expect(json1.changedRates).toBe(0);
    expect(json1.updated).toBe(0);

    const res2 = await POST(post(payload));
    const json2 = await res2.json();
    expect(updateRate).not.toHaveBeenCalled();
    expect(upsertCompanyWithRates).not.toHaveBeenCalled();
    // syncedAt 以外は同一結果
    expect({ ...json2, syncedAt: undefined }).toEqual({ ...json1, syncedAt: undefined });
  });

  it("1回目で変更を書いた後、DBがシートに追いついたら2回目は書かない", async () => {
    listCompanies.mockResolvedValue([
      { id: 7, code: "A1", name: "甲社", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 18000 } },
    ]);

    const payload = {
      companies: [
        { code: "A1", name: "甲社", prices: { ...emptyPrices(), ippan_day: 19000 }, hasPrice: true },
      ],
    };

    await POST(post(payload));
    expect(updateRate).toHaveBeenCalledTimes(1);

    // 1回目の書き込みが反映されたDB状態を再現
    vi.clearAllMocks();
    listCompanies.mockResolvedValue([
      { id: 7, code: "A1", name: "甲社", note: "", sortOrder: 0, prices: { ...emptyPrices(), ippan_day: 19000 } },
    ]);

    const res = await POST(post(payload));
    expect(updateRate).not.toHaveBeenCalled();
    expect((await res.json()).changedRates).toBe(0);
  });
});
