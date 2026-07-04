"use client";

import { useCallback, useEffect, useState } from "react";
import { RATE_DEFS, type RateKey } from "@/lib/prices";

interface AdminCompany {
  id: number;
  code: string;
  name: string;
  note: string;
  sortOrder: number;
  prices: Record<RateKey, number>;
}

interface HistoryRow {
  id: number;
  companyName: string;
  rateKey: string;
  oldPrice: number | null;
  newPrice: number | null;
  changedBy: string;
  changedAt: string;
}

const RATE_LABEL: Record<string, string> = Object.fromEntries(
  RATE_DEFS.map((d) => [d.key, d.label])
);

function yen(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ja-JP");
}

export default function AdminPage() {
  const [tab, setTab] = useState<"matrix" | "history">("matrix");
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // 編集中のセル { companyId, rateKey }
  const [editing, setEditing] = useState<{ id: number; key: RateKey } | null>(
    null
  );
  const [editValue, setEditValue] = useState("");

  // 新規会社フォーム
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const loadCompanies = useCallback(async () => {
    const res = await fetch("/api/admin/companies", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    const data = (await res.json()) as { companies?: AdminCompany[] };
    setCompanies(data.companies || []);
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/admin/history", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { history?: HistoryRow[] };
      setHistory(data.history || []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadCompanies();
      setLoading(false);
    })();
  }, [loadCompanies]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  function startEdit(id: number, key: RateKey, current: number) {
    setEditing({ id, key });
    setEditValue(String(current));
  }

  async function saveEdit() {
    if (!editing) return;
    const price = parseInt(editValue.replace(/[, ]/g, ""), 10);
    if (isNaN(price) || price < 0) {
      flash("0以上の数値を入力してください");
      return;
    }
    const { id, key } = editing;
    const prev = companies.find((c) => c.id === id)?.prices[key];
    setEditing(null);
    if (prev === price) return; // 変更なし
    const res = await fetch(`/api/admin/companies/${id}/rates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rateKey: key, price }),
    });
    if (res.ok) {
      setCompanies((cs) =>
        cs.map((c) =>
          c.id === id ? { ...c, prices: { ...c.prices, [key]: price } } : c
        )
      );
      flash("単価を更新しました");
    } else {
      flash("更新に失敗しました");
    }
  }

  async function addCompany() {
    const name = newName.trim();
    if (!name) {
      flash("会社名を入力してください");
      return;
    }
    const res = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newCode.trim(), name, note: newNote.trim() }),
    });
    if (res.ok) {
      setNewCode("");
      setNewName("");
      setNewNote("");
      await loadCompanies();
      flash("会社を追加しました");
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      flash(d.error || "追加に失敗しました");
    }
  }

  async function saveCompanyMeta(c: AdminCompany, name: string, note: string) {
    if (name === c.name && note === c.note) return;
    const res = await fetch(`/api/admin/companies/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, note }),
    });
    if (res.ok) {
      setCompanies((cs) =>
        cs.map((x) => (x.id === c.id ? { ...x, name, note } : x))
      );
      flash("会社情報を更新しました");
    } else {
      flash("更新に失敗しました");
    }
  }

  async function deleteCompany(c: AdminCompany) {
    if (!window.confirm(`「${c.name}」を削除しますか？（元に戻せます）`)) return;
    const res = await fetch(`/api/admin/companies/${c.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setCompanies((cs) => cs.filter((x) => x.id !== c.id));
      flash("会社を削除しました");
    } else {
      flash("削除に失敗しました");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <div className="wrap">
      <header className="hero">
        <h1>単価マスタ管理</h1>
        <button className="spacer" onClick={logout} style={{ marginLeft: "auto" }}>
          ログアウト
        </button>
      </header>
      <p className="muted">
        会社ごとの単価をここで編集すると、見積画面に反映されます（DB優先）。
      </p>

      <div className="admin-tabs">
        <button
          className={tab === "matrix" ? "active" : ""}
          onClick={() => setTab("matrix")}
        >
          単価マトリクス
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          変更履歴
        </button>
      </div>

      {loading ? (
        <div className="loading">読み込み中…</div>
      ) : tab === "matrix" ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>会社を追加</h2>
            <div className="edit-row">
              <label className="field" style={{ margin: 0 }}>
                <span>会社コード</span>
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="A0001"
                />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>会社名 *</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="株式会社◯◯"
                />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>備考</span>
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="任意"
                />
              </label>
              <button className="primary" onClick={addCompany}>
                追加
              </button>
              <span />
            </div>
          </div>

          {companies.length === 0 ? (
            <div className="card">
              <p className="muted">
                会社がまだありません。上のフォームで追加するか、初期データを
                <code> /api/admin/seed </code>で取り込んでください。
              </p>
            </div>
          ) : (
            <div className="matrix-scroll">
              <table className="matrix">
                <thead>
                  <tr>
                    <th className="company-col">会社</th>
                    {RATE_DEFS.map((d) => (
                      <th key={d.key} title={d.label}>
                        {d.label}
                        <br />
                        <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                          ({d.unit})
                        </span>
                      </th>
                    ))}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id}>
                      <th className="company-col">
                        <input
                          className="company-name"
                          defaultValue={c.name}
                          onBlur={(e) =>
                            saveCompanyMeta(c, e.target.value.trim(), c.note)
                          }
                          style={{ width: "100%", marginBottom: 4 }}
                        />
                        <input
                          className="company-meta"
                          defaultValue={c.note}
                          placeholder="備考"
                          onBlur={(e) =>
                            saveCompanyMeta(c, c.name, e.target.value.trim())
                          }
                          style={{ width: "100%" }}
                        />
                        <div className="company-meta">コード: {c.code || "—"}</div>
                      </th>
                      {RATE_DEFS.map((d) => {
                        const isEd =
                          editing &&
                          editing.id === c.id &&
                          editing.key === d.key;
                        return (
                          <td
                            key={d.key}
                            className="price-cell"
                            onClick={() =>
                              !isEd && startEdit(c.id, d.key, c.prices[d.key])
                            }
                          >
                            {isEd ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                              />
                            ) : (
                              yen(c.prices[d.key])
                            )}
                          </td>
                        );
                      })}
                      <td>
                        <button className="del" onClick={() => deleteCompany(c)}>
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <h2>変更履歴（最新100件）</h2>
          {history.length === 0 ? (
            <p className="muted">まだ変更履歴はありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="history">
                <thead>
                  <tr>
                    <th>日時</th>
                    <th>会社</th>
                    <th>区分</th>
                    <th>変更</th>
                    <th>担当</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.changedAt).toLocaleString("ja-JP")}</td>
                      <td>{h.companyName}</td>
                      <td>{RATE_LABEL[h.rateKey] || h.rateKey}</td>
                      <td>
                        <span className="old">{yen(h.oldPrice)}</span>
                        {" → "}
                        <span className="new">{yen(h.newPrice)}</span>
                      </td>
                      <td>{h.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
