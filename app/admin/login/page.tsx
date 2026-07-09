"use client";

import { useState } from "react";

// 管理ユーザー（サーバ側の ADMIN_USERS_JSON と対応）
const USERS = [
  { value: "takagi", label: "高木 社長" },
  { value: "nishimura", label: "西村さん" },
] as const;

export default function AdminLoginPage() {
  const [user, setUser] = useState<string>(USERS[0].value);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (res.ok) {
        window.location.href = "/admin";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error || "ログインに失敗しました");
    } catch {
      setErr("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header className="hero">
        <h1>単価マスタ管理 — ログイン</h1>
      </header>
      <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
        <form onSubmit={submit}>
          <label className="field">
            <span>ユーザー</span>
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              {USERS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>管理パスワード</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {err && (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 12px" }}>
              {err}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "確認中…" : "ログイン"}
          </button>
        </form>
      </div>
      <footer className="foot">
        <a href="/">見積もり画面へ戻る</a>
      </footer>
    </div>
  );
}
