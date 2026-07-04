import "server-only";
import {
  type Company,
  type PriceData,
  SHEET_ID,
  SHEET_RANGE,
  csvUrls,
  parseCSV,
  parseCompanyListCsv,
  readSaCreds,
  snapshotData,
} from "./prices";

// このモジュールはサーバ専用（googleapis = Node 依存）。
// クライアントから import される lib/prices.ts には絶対に置かない。

// ---- メモリキャッシュ（60秒） ----
let cache: { data: PriceData; at: number } | null = null;
const CACHE_MS = 60_000;

// サービスアカウント＋Sheets API でライブ読み取り。
// 鍵が無い／読めない場合は null を返し、呼び出し側がDBキャッシュ→スナップショットへフォールバック。
async function tryFetchViaServiceAccount(): Promise<Company[] | null> {
  const creds = readSaCreds();
  if (!creds) return null;
  try {
    // googleapis は実行時にだけ読む（鍵が無い環境ではロードもしない）
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGE,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = (res.data.values || []).map((r) =>
      (r as unknown[]).map((c) => (c == null ? "" : String(c)))
    );
    const companies = parseCompanyListCsv(rows);
    return companies.length > 0 ? companies : null;
  } catch {
    return null;
  }
}

// DBキャッシュ（GASが定期pushした最新データ）経由のライブ取得。
async function tryFetchFromDbCache(): Promise<Company[] | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { loadPriceCache } = await import("./price-cache-db");
    const row = await loadPriceCache();
    if (!row) return null;
    const payload = row.payload as { companies: Company[] };
    if (!Array.isArray(payload?.companies) || payload.companies.length === 0)
      return null;
    return payload.companies;
  } catch {
    return null;
  }
}

// 公開CSV経由のライブ取得（シートが公開されている場合のみ成功）。
async function tryFetchViaPublicCsv(): Promise<Company[] | null> {
  for (const url of csvUrls()) {
    try {
      const res = await fetch(url, {
        // サーバ側fetch・キャッシュ無効
        cache: "no-store",
        redirect: "follow",
        headers: { "User-Agent": "mitsumori-app/1.0" },
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();
      // ログインページ等のHTMLが返ってきたら失敗扱い
      if (ct.includes("text/html") || text.trimStart().startsWith("<")) continue;
      const rows = parseCSV(text);
      const companies = parseCompanyListCsv(rows);
      if (companies.length > 0) return companies;
    } catch {
      // 次のURLへ
    }
  }
  return null;
}

// ライブ取得：①SA → ②DBキャッシュ（GAS push）→ ③公開CSV の順に試す。
async function tryFetchLive(): Promise<Company[] | null> {
  const viaSa = await tryFetchViaServiceAccount();
  if (viaSa && viaSa.length) return viaSa;
  const viaDb = await tryFetchFromDbCache();
  if (viaDb && viaDb.length) return viaDb;
  return tryFetchViaPublicCsv();
}

// DB（単価マスタ）に生きている会社があれば、そこを最優先のデータ源にする。
// 管理画面 /admin で編集した単価をそのまま見積画面へ反映するための経路。
async function tryFetchFromAdminDb(): Promise<Company[] | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { hasActiveCompanies, loadCompaniesForPriceData } = await import(
      "./price-admin-db"
    );
    if (!(await hasActiveCompanies())) return null;
    const companies = await loadCompaniesForPriceData();
    return companies.length > 0 ? companies : null;
  } catch {
    return null;
  }
}

// 単価データを返す。①管理DB → ②ライブ取得（シート等）→ ③スナップショット。
export async function getPriceData(): Promise<PriceData> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let data: PriceData;
  const fromDb = await tryFetchFromAdminDb();
  if (fromDb && fromDb.length) {
    const base = snapshotData(true);
    data = { ...base, source: "DB (price_companies)", companies: fromDb };
    cache = { data, at: Date.now() };
    return data;
  }

  const live = await tryFetchLive();
  if (live && live.length) {
    const base = snapshotData(true);
    data = { ...base, companies: live };
  } else {
    data = snapshotData(false);
  }
  cache = { data, at: Date.now() };
  return data;
}
