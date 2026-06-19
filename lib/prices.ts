import snapshot from "@/data/prices-snapshot.json";

// ---- 型定義 ----
// 区分キー（昼/夜/法定休日 × 一般/有資格 ＋ それぞれの残業）
export type RateKey =
  | "ippan_day"
  | "ippan_day_ot"
  | "ippan_night"
  | "ippan_night_ot"
  | "ippan_holiday"
  | "ippan_holiday_ot"
  | "yushi_day"
  | "yushi_day_ot"
  | "yushi_night"
  | "yushi_night_ot"
  | "yushi_holiday"
  | "yushi_holiday_ot";

export interface RateMeta {
  key: RateKey;
  label: string; // 画面表示用の区分名
  unit: string; // 人日 / 時間
}

// 区分の表示順とラベル（人日＝1名×1日、残業＝時間）
export const RATE_DEFS: RateMeta[] = [
  { key: "ippan_day", label: "一般警備員（昼・基本）", unit: "人日" },
  { key: "ippan_day_ot", label: "一般警備員（昼・残業/時）", unit: "時間" },
  { key: "ippan_night", label: "一般警備員（夜勤）", unit: "人日" },
  { key: "ippan_night_ot", label: "一般警備員（夜勤・残業/時）", unit: "時間" },
  { key: "ippan_holiday", label: "一般警備員（法定休日）", unit: "人日" },
  { key: "ippan_holiday_ot", label: "一般警備員（法定休日・残業/時）", unit: "時間" },
  { key: "yushi_day", label: "有資格警備員（昼・基本）", unit: "人日" },
  { key: "yushi_day_ot", label: "有資格警備員（昼・残業/時）", unit: "時間" },
  { key: "yushi_night", label: "有資格警備員（夜勤）", unit: "人日" },
  { key: "yushi_night_ot", label: "有資格警備員（夜勤・残業/時）", unit: "時間" },
  { key: "yushi_holiday", label: "有資格警備員（法定休日）", unit: "人日" },
  { key: "yushi_holiday_ot", label: "有資格警備員（法定休日・残業/時）", unit: "時間" },
];

export interface Company {
  code: string;
  name: string;
  prices: Record<RateKey, number>;
  hasPrice: boolean;
}

export interface EquipmentItem {
  name: string;
  unit: string;
  price: number;
}

export interface PriceData {
  source: string;
  capturedAt: string;
  sheetId: string;
  live: boolean; // シートからライブ取得できたか（自動同期が効いているか）
  fetchedAt: string;
  equipment: EquipmentItem[];
  companies: Company[];
}

const SHEET_ID =
  process.env.PRICES_SHEET_ID ||
  "1LPgDarhRJJU_j7vywFI6kSOH8d6kvTPjsGkz--kkiCY";

// 公開CSVのエンドポイント候補（公開されていれば読める）
function csvUrls(): string[] {
  return [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`,
  ];
}

// ---- CSVパーサ（クォート内カンマ対応） ----
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
        // skip
      } else cur += c;
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function toNum(s: string): number {
  const n = parseInt((s || "").replace(/[, ]/g, "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

// v3_一覧.csv 形式の行を Company[] にする。
// 列順: No, 会社コード, 会社名, 一般[基本,残業,夜勤,残業,法定休日,残業], 有資格[基本,残業,夜勤,残業,法定休日,残業]
const RATE_ORDER: RateKey[] = [
  "ippan_day",
  "ippan_day_ot",
  "ippan_night",
  "ippan_night_ot",
  "ippan_holiday",
  "ippan_holiday_ot",
  "yushi_day",
  "yushi_day_ot",
  "yushi_night",
  "yushi_night_ot",
  "yushi_holiday",
  "yushi_holiday_ot",
];

function parseCompanyListCsv(rows: string[][]): Company[] {
  const companies: Company[] = [];
  for (const r of rows) {
    if (!/^\d+$/.test((r[0] || "").trim())) continue; // データ行のみ
    const code = (r[1] || "").trim();
    const name = (r[2] || "").trim();
    if (!name) continue;
    const prices = {} as Record<RateKey, number>;
    RATE_ORDER.forEach((k, i) => {
      prices[k] = toNum(r[3 + i]);
    });
    const hasPrice = Object.values(prices).some((v) => v > 0);
    companies.push({ code, name, prices, hasPrice });
  }
  return companies;
}

// ---- メモリキャッシュ（60秒） ----
let cache: { data: PriceData; at: number } | null = null;
const CACHE_MS = 60_000;

function snapshotData(live: boolean): PriceData {
  const s = snapshot as unknown as {
    source: string;
    capturedAt: string;
    sheetId: string;
    equipment: EquipmentItem[];
    companies: Company[];
  };
  return {
    source: s.source,
    capturedAt: s.capturedAt,
    sheetId: s.sheetId,
    live,
    fetchedAt: new Date().toISOString(),
    equipment: s.equipment,
    // 念のため hasPrice を再計算
    companies: s.companies.map((c) => ({
      ...c,
      hasPrice: Object.values(c.prices).some((v) => v > 0),
    })),
  };
}

async function tryFetchLive(): Promise<Company[] | null> {
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

// 単価データを返す。ライブ取得を試し、失敗時はスナップショットにフォールバック。
export async function getPriceData(): Promise<PriceData> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const live = await tryFetchLive();
  let data: PriceData;
  if (live && live.length) {
    const base = snapshotData(true);
    data = { ...base, companies: live };
  } else {
    data = snapshotData(false);
  }
  cache = { data, at: Date.now() };
  return data;
}

// 会社一覧（単価が入っている会社を先頭に）
export function sortCompanies(companies: Company[]): Company[] {
  return [...companies].sort((a, b) => {
    if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
    return a.name.localeCompare(b.name, "ja");
  });
}
