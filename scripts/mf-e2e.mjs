// MFクラウド請求書 API 実証E2E（ローカル・1プロセス・トークンはメモリ保持）。
//   1) localhost:3000 で /api/mf-callback を待ち受け
//   2) 認可URLを表示（ブラウザで開いて許可）
//   3) code → access_token 交換
//   4) 取引先（部門）を用意 → 見積書を作成 → pdf_url 取得
//   5) 作成したテスト見積書を削除（後片付け）
//
// 使い方: node scripts/mf-e2e.mjs
//   .env.local の MF_CLIENT_ID / MF_CLIENT_SECRET / MF_REDIRECT_URI を読む。

import http from "node:http";
import fs from "node:fs";

// --- .env.local 読み込み（依存ゼロ）---
function loadEnv() {
  try {
    const txt = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      // 既に環境変数で渡されていれば上書きしない（インライン指定を優先）
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const CLIENT_ID = process.env.MF_CLIENT_ID;
const CLIENT_SECRET = process.env.MF_CLIENT_SECRET;
const PORT = Number(process.env.MF_E2E_PORT || 3000);
const REDIRECT_URI =
  process.env.MF_REDIRECT_URI || `http://localhost:${PORT}/api/mf-callback`;
const AUTH_BASE = "https://api.biz.moneyforward.com";
const API_BASE = "https://invoice.moneyforward.com/api/v3";
const SCOPE = "mfc/invoice/data.write";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("MF_CLIENT_ID / MF_CLIENT_SECRET が未設定です（.env.local）");
  process.exit(1);
}

const basic = "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

function authorizeUrl(state) {
  const u = new URL(`${AUTH_BASE}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  return u.toString();
}

async function exchange(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basic,
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function api(path, init = {}, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(init.headers || {}),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const state = "e2e-" + Math.random().toString(36).slice(2);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/api/mf-callback")) {
    res.writeHead(404).end("not callback");
    return;
  }
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400).end("error: " + err);
    console.error("認可エラー:", err);
    server.close();
    process.exit(1);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>認可OK。ターミナルに戻ってください。</h1>");

  try {
    console.log("\n[2] code 受領 →トークン交換中...");
    const tok = await exchange(code);
    const token = tok.access_token;
    console.log("    access_token 取得:", token.slice(0, 12) + "...(len " + token.length + ")");
    console.log("    refresh_token:", tok.refresh_token ? "あり" : "なし", "/ expires_in:", tok.expires_in);

    // 取引先を用意
    const pname = "API実証テスト取引先 " + new Date().toISOString().slice(0, 10);
    console.log("\n[3] 取引先 検索/作成:", pname);
    let dep = await api(`/partners?name=${encodeURIComponent(pname)}`, { method: "GET" }, token);
    let partner = dep.ok ? (JSON.parse(dep.text).data || [])[0] : null;
    if (!partner) {
      const cr = await api(
        `/partners`,
        { method: "POST", body: JSON.stringify({ name: pname, departments: [{ person_name: pname }] }) },
        token
      );
      if (!cr.ok) throw new Error(`partner create ${cr.status}: ${cr.text}`);
      partner = JSON.parse(cr.text);
    }
    const departmentId = partner.departments?.[0]?.id;
    console.log("    partner_id:", partner.id, "/ department_id:", departmentId);

    // 見積書を作成
    const today = new Date().toISOString().slice(0, 10);
    const expired = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const quoteBody = {
      department_id: departmentId,
      quote_date: today,
      expired_date: expired,
      title: "API実証 御見積書",
      items: [
        { name: "交通誘導警備（昼・一般）", unit: "人日", price: 18000, quantity: 6, excise: "ten_percent" },
        { name: "カラーコーン", unit: "式", price: 4500, quantity: 2, excise: "ten_percent" },
      ],
    };
    console.log("\n[4] 見積書を作成中...");
    const q = await api(`/quotes`, { method: "POST", body: JSON.stringify(quoteBody) }, token);
    if (!q.ok) throw new Error(`quote create ${q.status}: ${q.text}`);
    const quote = JSON.parse(q.text);
    console.log("    ✅ 見積書 作成成功");
    console.log("       id:", quote.id);
    console.log("       quote_number:", quote.quote_number);
    console.log("       pdf_url:", quote.pdf_url);
    console.log("       partner_name:", quote.partner_name, "/ total:", quote.total);

    // 後片付け：見積書を削除
    console.log("\n[5] テスト見積書を削除中...");
    const del = await api(`/quotes/${encodeURIComponent(quote.id)}`, { method: "DELETE" }, token);
    console.log("    見積書 削除:", del.status, del.ok ? "OK" : del.text);

    // 後片付け：テスト取引先も削除（残骸ゼロ）
    const pdel = await api(
      `/partners/${encodeURIComponent(partner.id)}`,
      { method: "DELETE" },
      token
    );
    console.log("    取引先 削除:", pdel.status, pdel.ok ? "OK" : pdel.text);

    console.log("\n=== E2E 成功：APIで見積書を作成→PDF URL取得→見積書/取引先を削除まで実証 ===");
  } catch (e) {
    console.error("\n[FAIL]", e.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log(`[1] localhost:${PORT} 待受開始。次のURLをブラウザで開いて『許可』してください:\n`);
  console.log(authorizeUrl(state));
  console.log("");
});
