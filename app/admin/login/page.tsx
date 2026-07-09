"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// 管理ユーザー（サーバ側の ADMIN_USERS_JSON と対応）
const USERS = [
  { value: "takagi", label: "高木 社長" },
  { value: "nishimura", label: "西村さん" },
] as const;

function LoginForm() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<string>(USERS[0].value);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setErr(errorParam);
    }
  }, [searchParams]);

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

  async function handleGoogleLogin() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/google-login", { method: "POST" });
      const data = (await res.json()) as { redirectUrl?: string };
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch {
      setErr("Google ログインの初期化に失敗しました");
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header className="hero">
        <h1>単価マスタ管理 — ログイン</h1>
      </header>
      <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: "white",
            border: "1px solid #ddd",
            borderRadius: "6px",
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: "14px",
            fontWeight: "500",
            marginBottom: "20px",
          }}
          onMouseEnter={(e) => {
            if (!busy) e.currentTarget.style.background = "#f9f9f9";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "white";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Google でログイン
        </button>

        {err && (
          <p style={{ color: "var(--danger)", fontSize: 13, margin: "12px 0 0", textAlign: "center" }}>
            {err}
          </p>
        )}
      </div>
      <footer className="foot">
        <a href="/">見積もり画面へ戻る</a>
      </footer>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="loading">読み込み中…</div></div>}>
      <LoginForm />
    </Suspense>
  );
}
