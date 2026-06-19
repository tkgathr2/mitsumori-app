"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RATE_DEFS,
  type RateKey,
  type Company,
  type EquipmentItem,
} from "@/lib/prices";
import { calcTotals, lineAmount, yen, type QuoteLine } from "@/lib/quote";

type ApiData = {
  source: string;
  capturedAt: string;
  live: boolean;
  fetchedAt: string;
  equipment: EquipmentItem[];
  companies: Company[];
};

// 行の内部表現
type Row = {
  id: number;
  // 警備行: rateKey で単価を引く / 自由行: free=true で名前・単価を直接入力
  free: boolean;
  rateKey: RateKey | "";
  name: string; // 自由行の品目名
  unit: string;
  unitPrice: number; // 自由行で使う単価
  people: string; // 警備行: 人数
  days: string; // 警備行: 日数
  qty: string; // 自由行: 数量
};

let _id = 1;
const newSecurityRow = (): Row => ({
  id: _id++,
  free: false,
  rateKey: "",
  name: "",
  unit: "人日",
  unitPrice: 0,
  people: "1",
  days: "1",
  qty: "1",
});
const newFreeRow = (preset?: Partial<Row>): Row => ({
  id: _id++,
  free: true,
  rateKey: "",
  name: preset?.name ?? "",
  unit: preset?.unit ?? "式",
  unitPrice: preset?.unitPrice ?? 0,
  people: "1",
  days: "1",
  qty: "1",
});

export default function Page() {
  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [companyCode, setCompanyCode] = useState("");
  const [rows, setRows] = useState<Row[]>([newSecurityRow()]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d: ApiData) => {
        setData(d);
        const first = d.companies.find((c) => c.hasPrice) || d.companies[0];
        if (first) setCompanyCode(first.code);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const company = useMemo(
    () => data?.companies.find((c) => c.code === companyCode) || null,
    [data, companyCode]
  );

  // 区分→単価（選択中の会社で引く）
  function ratePrice(key: RateKey): number {
    if (!company) return 0;
    return company.prices[key] ?? 0;
  }
  function rateUnit(key: RateKey): string {
    return RATE_DEFS.find((d) => d.key === key)?.unit ?? "人日";
  }

  // QuoteLine への変換
  function toQuoteLine(row: Row): QuoteLine {
    if (row.free) {
      return {
        name: row.name || "（自由入力）",
        unitPrice: Number(row.unitPrice) || 0,
        unit: row.unit,
        qty: Number(row.qty) || 0,
      };
    }
    const price = row.rateKey ? ratePrice(row.rateKey) : 0;
    const unit = row.rateKey ? rateUnit(row.rateKey) : "人日";
    if (unit === "時間") {
      // 残業（時間）: 数量 = 時間。people欄を時間として使う、days非表示。
      return {
        name: rateLabel(row.rateKey),
        unitPrice: price,
        unit,
        qty: Number(row.people) || 0,
      };
    }
    return {
      name: rateLabel(row.rateKey),
      unitPrice: price,
      unit,
      people: Number(row.people) || 0,
      days: Number(row.days) || 0,
    };
  }

  function rateLabel(key: RateKey | ""): string {
    if (!key) return "（区分未選択）";
    return RATE_DEFS.find((d) => d.key === key)?.label ?? key;
  }

  const lines = rows.map(toQuoteLine);
  const totals = calcTotals(lines);

  function update(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  async function onMfClick() {
    setToast("MFに見積書を作成中…");
    try {
      const res = await fetch("/api/mf-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: company?.name ?? "",
          lines,
          totals,
        }),
      });
      const j = await res.json();
      setToast(j.message || "送信しました");
      // 見積書PDFができたら新しいタブで開く
      if (j.ok && j.pdfUrl) {
        window.open(j.pdfUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setToast("通信エラー: " + String(e));
    }
    setTimeout(() => setToast(null), 8000);
  }

  if (err) {
    return (
      <div className="wrap">
        <div className="card">単価データの読み込みに失敗しました: {err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="wrap">
        <div className="loading">単価データを読み込み中…</div>
      </div>
    );
  }

  // 区分の選択肢（単価が0の区分も選べるが0表示）
  const rateOptions = RATE_DEFS;

  return (
    <div className="wrap">
      <header className="hero">
        <img src="/icon512.png" alt="見積もりくん" />
        <div>
          <h1>見積もり自動化システム</h1>
          <p>会社を選んで、区分・人数・日数を入れるだけ。金額は自動で出ます。</p>
        </div>
        <span className={"sync-badge " + (data.live ? "live" : "snapshot")}>
          <span className="dot" />
          {data.live ? "単価シート ライブ同期中" : "単価スナップショット使用中"}
        </span>
      </header>

      <div className="layout">
        <main>
          <div className="card">
            <h2>1. 会社を選ぶ</h2>
            <label className="field">
              <span>会社（単価表の会社）</span>
              <select
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
              >
                {data.companies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                    {c.hasPrice ? "" : "（単価未登録）"}
                  </option>
                ))}
              </select>
            </label>
            {company && !company.hasPrice && (
              <p className="muted">
                この会社はまだ単価が登録されていません。区分を選んでも0円になります。
              </p>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>2. 明細を入れる</h2>
            <div className="lines">
              {rows.map((row) => {
                const ql = toQuoteLine(row);
                const amount = lineAmount(ql);
                const unit = row.free ? row.unit : rateUnit(row.rateKey as RateKey);
                const isHourly = !row.free && unit === "時間";
                return (
                  <div className="line" key={row.id}>
                    {row.free ? (
                      <>
                        <div className="row1">
                          <label className="field" style={{ margin: 0 }}>
                            <span>品目名（機材・遠方・規制車など自由入力）</span>
                            <input
                              type="text"
                              value={row.name}
                              placeholder="例：規制車両費（レンタル）"
                              onChange={(e) =>
                                update(row.id, { name: e.target.value })
                              }
                            />
                          </label>
                          <div className="amount">{yen(amount)}</div>
                        </div>
                        <div className="row2">
                          <label className="field" style={{ margin: 0 }}>
                            <span>単価（円）</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              value={row.unitPrice}
                              onChange={(e) =>
                                update(row.id, {
                                  unitPrice: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </label>
                          <label className="field" style={{ margin: 0 }}>
                            <span>単位</span>
                            <input
                              type="text"
                              value={row.unit}
                              onChange={(e) =>
                                update(row.id, { unit: e.target.value })
                              }
                            />
                          </label>
                          <label className="field" style={{ margin: 0 }}>
                            <span>数量</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              value={row.qty}
                              onChange={(e) =>
                                update(row.id, { qty: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className="del"
                            onClick={() => remove(row.id)}
                            title="この行を削除"
                          >
                            削除
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="row1">
                          <label className="field" style={{ margin: 0 }}>
                            <span>区分（昼/夜勤/法定休日・一般/有資格）</span>
                            <select
                              value={row.rateKey}
                              onChange={(e) =>
                                update(row.id, {
                                  rateKey: e.target.value as RateKey,
                                })
                              }
                            >
                              <option value="">区分を選んでください</option>
                              {rateOptions.map((d) => (
                                <option key={d.key} value={d.key}>
                                  {d.label} — {yen(ratePriceSafe(company, d.key))}/
                                  {d.unit}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="amount">
                            {yen(amount)}
                            <div className="unitprice">
                              {row.rateKey
                                ? `単価 ${yen(ratePrice(row.rateKey))}/${unit}`
                                : ""}
                            </div>
                          </div>
                        </div>
                        <div className="row2">
                          {isHourly ? (
                            <label className="field" style={{ margin: 0 }}>
                              <span>残業時間（時間）</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                value={row.people}
                                onChange={(e) =>
                                  update(row.id, { people: e.target.value })
                                }
                              />
                            </label>
                          ) : (
                            <>
                              <label className="field" style={{ margin: 0 }}>
                                <span>人数（名）</span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={row.people}
                                  onChange={(e) =>
                                    update(row.id, { people: e.target.value })
                                  }
                                />
                              </label>
                              <label className="field" style={{ margin: 0 }}>
                                <span>日数（日）</span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={row.days}
                                  onChange={(e) =>
                                    update(row.id, { days: e.target.value })
                                  }
                                />
                              </label>
                            </>
                          )}
                          <div />
                          <button
                            className="del"
                            onClick={() => remove(row.id)}
                            title="この行を削除"
                          >
                            削除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="btnrow">
              <button onClick={() => setRows((rs) => [...rs, newSecurityRow()])}>
                ＋ 警備の行を追加
              </button>
              <button onClick={() => setRows((rs) => [...rs, newFreeRow()])}>
                ＋ 自由入力行（機材・遠方・規制車など）
              </button>
            </div>

            {data.equipment.length > 0 && (
              <div className="btnrow">
                {data.equipment.map((eq) => (
                  <button
                    key={eq.name}
                    onClick={() =>
                      setRows((rs) => [
                        ...rs,
                        newFreeRow({
                          name: eq.name,
                          unit: eq.unit,
                          unitPrice: eq.price,
                        }),
                      ])
                    }
                  >
                    ＋ {eq.name}（{yen(eq.price)}）
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        <aside>
          <div className="card totals">
            <h2>お見積り金額</h2>
            <div className="totrow">
              <span className="label">小計（税抜）</span>
              <span>{yen(totals.subtotal)}</span>
            </div>
            <div className="totrow">
              <span className="label">消費税（10%）</span>
              <span>{yen(totals.tax)}</span>
            </div>
            <div className="totrow grand">
              <span>合計</span>
              <span>{yen(totals.total)}</span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="primary" style={{ width: "100%" }} onClick={onMfClick}>
                MFに見積を作成
              </button>
              <p className="muted" style={{ marginTop: 8 }}>
                ※ 押すとMFクラウド請求書に見積書を作成し、PDFを開きます。
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="foot">
        <p>
          使いづらい / こうしてほしい →{" "}
          <a
            href="https://kaizen.takagi.bz/?sys=mitsumori"
            target="_blank"
            rel="noreferrer"
          >
            カイゼンくんに伝える
          </a>
        </p>
        <p className="muted">
          単価の元データ：{data.source}（{data.live ? "シートからライブ取得" : "スナップショット"}）
        </p>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// 会社未確定でも安全に単価を引く
function ratePriceSafe(company: Company | null, key: RateKey): number {
  if (!company) return 0;
  return company.prices[key] ?? 0;
}
