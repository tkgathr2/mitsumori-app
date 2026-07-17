"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RATE_DEFS,
  type RateKey,
  type Company,
  type EquipmentItem,
} from "@/lib/prices";
import {
  calcTotals,
  lineAmount,
  resolveUnitPrice,
  yen,
  type QuoteLine,
} from "@/lib/quote";

type ApiData = {
  source: string;
  capturedAt: string;
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
  overridePrice?: number; // 警備行で手動上書きした単価（あれば優先）
  people: string; // 警備行: 人数
  days: string; // 警備行: 日数
  qty: string; // 自由行: 数量
};

// 保存済み見積（過去の見積呼び出し用）
type PastQuote = {
  id: number;
  name: string;
  quoteData: { rows: Omit<Row, "id">[]; total: number };
  createdAt: string;
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
  const [companySearch, setCompanySearch] = useState<string | undefined>();
  const [showCompanyList, setShowCompanyList] = useState(false);
  const [companyMode, setCompanyMode] = useState<"select" | "search">("select");
  const [companyHistory, setCompanyHistory] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([newSecurityRow()]);
  const [toast, setToast] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [pastQuotes, setPastQuotes] = useState<PastQuote[]>([]);
  const [savingQuote, setSavingQuote] = useState(false);
  const [sendingToMf, setSendingToMf] = useState(false);

  // localStorage から会社履歴を読込
  useEffect(() => {
    const saved = localStorage.getItem("companyHistory");
    if (saved) {
      try {
        setCompanyHistory(JSON.parse(saved));
      } catch {}
    }
  }, []);

  // 会社を選択したら履歴に追加・ソート
  const selectCompany = (code: string) => {
    setCompanyCode(code);
    setCompanySearch(undefined);
    setShowCompanyList(false);

    const updated = [code, ...companyHistory.filter((c) => c !== code)].slice(
      0,
      10
    ); // 最大10件
    setCompanyHistory(updated);
    localStorage.setItem("companyHistory", JSON.stringify(updated));
  };

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

  // 会社を選んだら過去の見積（直近5種類）を取得
  useEffect(() => {
    if (!companyCode) {
      setPastQuotes([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/quotes?company=${encodeURIComponent(companyCode)}`)
      .then((r) => r.json())
      .then((j: { quotes?: PastQuote[] }) => {
        if (!cancelled) setPastQuotes(j.quotes ?? []);
      })
      .catch(() => {
        if (!cancelled) setPastQuotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyCode]);

  // 現在の明細を履歴として保存（同一内容はサーバー側で1種類に集約）
  async function saveCurrentQuote(silent = false): Promise<void> {
    if (!companyCode) return;
    // ダブルサブミット防止：保存処理が実行中なら再入を弾く。
    if (savingQuote) return;
    setSavingQuote(true);
    const cleanRows = rows.map(({ id: _drop, ...rest }) => rest);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          name: `${new Date().toLocaleDateString("ja-JP")} ${yen(totals.total)}`,
          quoteData: { rows: cleanRows, total: totals.total },
        }),
      });
      if (res.ok) {
        const j = (await fetch(
          `/api/quotes?company=${encodeURIComponent(companyCode)}`
        ).then((r) => r.json())) as { quotes?: PastQuote[] };
        setPastQuotes(j.quotes ?? []);
        if (!silent) {
          setToast("この見積を履歴に保存しました");
          setTimeout(() => setToast(null), 4000);
        }
      } else if (!silent) {
        setToast("履歴の保存に失敗しました");
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      if (!silent) {
        setToast("履歴の保存に失敗しました（通信エラー）");
        setTimeout(() => setToast(null), 4000);
      }
    } finally {
      setSavingQuote(false);
    }
  }

  // 過去の見積を呼び出して明細に展開
  function loadPastQuote(q: PastQuote): void {
    const saved = q.quoteData?.rows;
    if (!Array.isArray(saved) || saved.length === 0) return;
    setRows(saved.map((r) => ({ ...r, id: _id++ })));
    setToast(`過去の見積「${q.name}」を呼び出しました`);
    setTimeout(() => setToast(null), 4000);
  }

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
    const autoPrice = row.rateKey ? ratePrice(row.rateKey) : 0;
    const price = resolveUnitPrice(autoPrice, row.overridePrice);
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

  // 数値入力（人数・日数・数量など）を 0〜999 の範囲に正規化する。
  // 負数・NaN・過大値の入力を弾き、明細の暴走的な金額計算を防ぐ。
  function clampNumericInput(value: string): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.min(999, Math.max(0, n)));
  }
  function remove(id: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  async function onMfClick() {
    // ダブルサブミット防止：MF送信中の再クリックを弾く（重複請求書作成を防ぐ）。
    if (sendingToMf) return;
    setSendingToMf(true);
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
      // MFに作成できた見積は履歴にも自動保存
      if (j.ok) void saveCurrentQuote(true);
    } catch (e) {
      setToast("通信エラー: " + String(e));
    } finally {
      setSendingToMf(false);
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

  // 単価が1社も取れなかったときは、見積画面を出さずに理由と次の一手を示す。
  // （スナップショットへのフォールバックは撤去した＝間違った金額を出すより出さない方が安全）
  if (data.companies.length === 0) {
    return (
      <div className="wrap">
        <div className="card">
          <h2>単価を取得できませんでした</h2>
          <p>
            管理画面で単価を登録してください。単価は管理画面の単価マスタが正です。
          </p>
          <p>
            <a href="/admin">🔧 管理画面をひらく</a>
          </p>
        </div>
      </div>
    );
  }

  // 区分の選択肢（単価が0の区分も選べるが0表示）
  const rateOptions = RATE_DEFS;

  return (
    <div className="wrap">
      <header className="hero">
        <img src="/favicon.svg" alt="みつもりくん" style={{ width: "64px", height: "64px" }} />
        <div>
          <h1>みつもりくん</h1>
          <p>会社を選んで、区分・人数・日数を入れるだけで、見積金額が一瞬で出ます。</p>
        </div>
        <span className="sync-badge live">
          <span className="dot" />
          単価マスタ（管理画面）を使用中
        </span>
        <a href="/admin" className="admin-link" title="管理画面">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>管理画面</span>
        </a>
      </header>

      <div className="layout">
        <main>
          <div className="card">
            <h2>1. 会社を選ぶ</h2>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <button
                onClick={() => setCompanyMode("select")}
                style={{
                  padding: "6px 12px",
                  background: companyMode === "select" ? "#007bff" : "#e9ecef",
                  color: companyMode === "select" ? "white" : "black",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                選択式
              </button>
              <button
                onClick={() => setCompanyMode("search")}
                style={{
                  padding: "6px 12px",
                  background: companyMode === "search" ? "#007bff" : "#e9ecef",
                  color: companyMode === "search" ? "white" : "black",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                検索式
              </button>
            </div>

            {companyMode === "select" ? (
              <label className="field">
                <span>会社（単価表の会社）</span>
                <div style={{ overflowY: "auto", maxHeight: "300px" }}>
                  {companyHistory.length > 0 && (
                    <>
                      <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px", fontWeight: "bold" }}>最近使った会社</div>
                      {companyHistory.map((code) => {
                        const c = data?.companies.find((cc) => cc.code === code);
                        return c ? (
                          <div
                            key={code}
                            onClick={() => selectCompany(code)}
                            style={{
                              padding: "8px 12px",
                              marginBottom: "4px",
                              background: companyCode === code ? "#e7f0ff" : "white",
                              border: companyCode === code ? "2px solid #007bff" : "1px solid #ddd",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = companyCode === code ? "#e7f0ff" : "white")
                            }
                          >
                            {c.name}
                            {c.hasPrice ? "" : "（単価未登録）"}
                          </div>
                        ) : null;
                      })}
                      <hr style={{ margin: "12px 0", borderColor: "#eee" }} />
                    </>
                  )}
                  <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px", fontWeight: "bold" }}>すべての会社</div>
                  {data?.companies.map((c) => (
                    <div
                      key={c.code}
                      onClick={() => selectCompany(c.code)}
                      style={{
                        padding: "8px 12px",
                        marginBottom: "4px",
                        background: companyCode === c.code ? "#e7f0ff" : "white",
                        border: companyCode === c.code ? "2px solid #007bff" : "1px solid #ddd",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = companyCode === c.code ? "#e7f0ff" : "white")
                      }
                    >
                      {c.name}
                      {c.hasPrice ? "" : "（単価未登録）"}
                    </div>
                  ))}
                </div>
              </label>
            ) : (
              <label className="field">
                <span>会社（単価表の会社）</span>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="会社名で検索..."
                    value={
                      companySearch !== undefined
                        ? companySearch
                        : data?.companies.find((c) => c.code === companyCode)
                            ?.name || ""
                    }
                    onChange={(e) => {
                      setCompanySearch(e.target.value);
                      const match = data?.companies.find(
                        (c) =>
                          c.name.toLowerCase() ===
                          e.target.value.toLowerCase()
                      );
                      if (match) selectCompany(match.code);
                    }}
                    onFocus={() => setShowCompanyList(true)}
                    onBlur={() => setTimeout(() => setShowCompanyList(false), 200)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  />
                  {showCompanyList && companySearch !== undefined && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: "4px",
                        background: "white",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        maxHeight: "200px",
                        overflowY: "auto",
                        zIndex: 10,
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                      }}
                    >
                      {data?.companies
                        .filter((c) =>
                          c.name
                            .toLowerCase()
                            .includes(companySearch.toLowerCase())
                        )
                        .map((c) => (
                          <div
                            key={c.code}
                            onClick={() => selectCompany(c.code)}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              borderBottom: "1px solid #eee",
                              fontSize: "14px",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background = "#f5f5f5")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = "white")
                            }
                          >
                            {c.name}
                            {c.hasPrice ? "" : "（単価未登録）"}
                          </div>
                        ))}
                      {data?.companies.filter((c) =>
                        c.name
                          .toLowerCase()
                          .includes(companySearch.toLowerCase())
                      ).length === 0 && (
                        <div
                          style={{
                            padding: "8px 12px",
                            color: "#999",
                            fontSize: "14px",
                          }}
                        >
                          該当する会社がありません
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </label>
            )}
            {company && !company.hasPrice && (
              <p className="muted">
                この会社はまだ単価が登録されていません。区分を選んでも0円になります。
              </p>
            )}
            {pastQuotes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#3b82f6", marginBottom: 6 }}>
                  この会社の過去の見積（直近{pastQuotes.length}種類・クリックで呼び出し）
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {pastQuotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => loadPastQuote(q)}
                      style={{
                        padding: "8px 12px",
                        background: "white",
                        border: "1px solid #bfdbfe",
                        borderRadius: 6,
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                    >
                      <span style={{ fontWeight: 600 }}>{q.name || "（無題）"}</span>
                      <br />
                      <span style={{ color: "#64748b", fontSize: 11 }}>
                        {new Date(q.createdAt).toLocaleDateString("ja-JP")}・
                        {q.quoteData?.rows?.length ?? 0}行
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
                                update(row.id, { qty: clampNumericInput(e.target.value) })
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
                                  overridePrice: undefined,
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
                                ? `単価 ${yen(ql.unitPrice)}/${unit}` +
                                  (row.overridePrice != null ? "（上書き）" : "")
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
                                  update(row.id, { people: clampNumericInput(e.target.value) })
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
                                    update(row.id, { people: clampNumericInput(e.target.value) })
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
                                    update(row.id, { days: clampNumericInput(e.target.value) })
                                  }
                                />
                              </label>
                            </>
                          )}
                          {row.rateKey && editingPriceId === row.id ? (
                            <label className="field" style={{ margin: 0 }}>
                              <span>単価（円・上書き）</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                autoFocus
                                value={
                                  row.overridePrice ?? ratePrice(row.rateKey as RateKey)
                                }
                                onChange={(e) =>
                                  update(row.id, {
                                    overridePrice: Number(e.target.value) || 0,
                                  })
                                }
                                onBlur={() => setEditingPriceId(null)}
                              />
                            </label>
                          ) : row.rateKey ? (
                            <button
                              type="button"
                              className="edit-price"
                              onClick={() => setEditingPriceId(row.id)}
                              title="単価を手動で上書きする"
                            >
                              {row.overridePrice != null
                                ? "単価編集中（上書きあり）"
                                : "単価編集"}
                            </button>
                          ) : (
                            <div />
                          )}
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
              <button
                className="primary"
                style={{ width: "100%", opacity: sendingToMf ? 0.7 : 1 }}
                onClick={onMfClick}
                disabled={sendingToMf}
              >
                {sendingToMf ? "作成中…" : "MFに見積を作成"}
              </button>
              <p className="muted" style={{ marginTop: 8 }}>
                ※ 押すとMFクラウド請求書に見積書を作成し、PDFを開きます。
              </p>
              <button
                type="button"
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "10px 12px",
                  background: "white",
                  color: "#3b82f6",
                  border: "1px solid #3b82f6",
                  borderRadius: 6,
                  cursor: savingQuote ? "default" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: savingQuote ? 0.7 : 1,
                }}
                onClick={() => void saveCurrentQuote()}
                disabled={savingQuote}
              >
                {savingQuote ? "保存中…" : "この見積を履歴に保存"}
              </button>
              <p className="muted" style={{ marginTop: 8 }}>
                ※ 保存すると、次回この会社を選んだとき「過去の見積」から呼び出せます。
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="foot">
        <p>
          <a href="/admin">🔧 管理画面（単価マスタの確認・編集）</a>
        </p>
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
          単価の元データ：{data.source} ／ 資器材：スナップショット（{data.capturedAt} 取得）
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
