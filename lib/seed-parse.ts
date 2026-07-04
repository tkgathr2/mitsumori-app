import { parseCSV, RATE_DEFS, type RateKey } from "./prices";

// seed（初期データ移行）用のCSV/JSONパーサ。
// 新シートの列構成は未確定なので、次の順で会社行を組み立てる：
//   1. ヘッダ行に「会社名」「会社コード」「備考」等があれば、それを優先して列位置を特定。
//   2. ヘッダが読めなければ、既存 v3 と同じ固定列順（No, コード, 会社名, 12単価）を仮定。
// 単価列は「一般6区分＋有資格6区分」の12列を RATE_DEFS の順で読む。

const RATE_ORDER: RateKey[] = RATE_DEFS.map((d) => d.key);

export interface SeedCompany {
  code: string;
  name: string;
  note: string;
  prices: Record<string, number>;
}

function toNum(s: unknown): number {
  const n = parseInt(String(s ?? "").replace(/[, ¥￥]/g, "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

// ヘッダ行かどうか（会社名/会社コード/備考 のどれかを含む）。
function looksLikeHeader(row: string[]): boolean {
  const joined = row.map(norm).join("|");
  return /会社名|会社コード|コード|備考|名称|会社/.test(joined);
}

// ヘッダから列インデックスを推定（見つからない列は -1）。
function detectColumns(header: string[]): {
  code: number;
  name: number;
  note: number;
  rateStart: number;
} {
  const cells = header.map(norm);
  const findIdx = (re: RegExp) => cells.findIndex((c) => re.test(c));
  const code = findIdx(/^(会社)?コード$|コード/);
  const name = findIdx(/会社名|名称|^会社$/);
  const note = findIdx(/備考|メモ|注記/);
  // 単価列の開始 = 会社名列の次（コード/名前/備考の最大index+1）を素直に採用。
  const maxLabel = Math.max(code, name, note);
  const rateStart = maxLabel >= 0 ? maxLabel + 1 : 3;
  return { code, name, note, rateStart };
}

// CSVテキスト → SeedCompany[]
export function parseSeedCsv(text: string): SeedCompany[] {
  const rows = parseCSV(text).filter((r) => r.some((c) => norm(c) !== ""));
  if (rows.length === 0) return [];

  let header: string[] | null = null;
  let bodyStart = 0;
  if (looksLikeHeader(rows[0])) {
    header = rows[0];
    bodyStart = 1;
  }

  if (header) {
    const cols = detectColumns(header);
    // 会社名列が特定できたときはヘッダ駆動で読む。
    if (cols.name >= 0) {
      const out: SeedCompany[] = [];
      for (let i = bodyStart; i < rows.length; i++) {
        const r = rows[i];
        const name = norm(r[cols.name]);
        if (!name) continue;
        const code = cols.code >= 0 ? norm(r[cols.code]) : "";
        const note = cols.note >= 0 ? norm(r[cols.note]) : "";
        const prices: Record<string, number> = {};
        RATE_ORDER.forEach((k, j) => {
          prices[k] = toNum(r[cols.rateStart + j]);
        });
        out.push({ code, name, note, prices });
      }
      if (out.length > 0) return out;
    }
  }

  // フォールバック：既存 v3 固定列（No, コード, 会社名, 12単価[, 備考]）。
  const out: SeedCompany[] = [];
  for (const r of rows) {
    if (!/^\d+$/.test(norm(r[0]))) continue; // データ行のみ
    const code = norm(r[1]);
    const name = norm(r[2]);
    if (!name) continue;
    const prices: Record<string, number> = {};
    RATE_ORDER.forEach((k, j) => {
      prices[k] = toNum(r[3 + j]);
    });
    const note = norm(r[3 + RATE_ORDER.length]); // 12単価の次に備考があれば
    out.push({ code, name, note, prices });
  }
  return out;
}

// JSON配列（company一覧）→ SeedCompany[]。柔軟にキーを拾う。
export function parseSeedJson(companies: unknown[]): SeedCompany[] {
  const out: SeedCompany[] = [];
  for (const raw of companies) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const name = norm(o.name ?? o["会社名"] ?? o["名称"]);
    if (!name) continue;
    const code = norm(o.code ?? o["会社コード"] ?? o["コード"]);
    const note = norm(o.note ?? o["備考"] ?? o["メモ"]);
    const prices: Record<string, number> = {};
    const src = (o.prices ?? {}) as Record<string, unknown>;
    for (const k of RATE_ORDER) {
      prices[k] = toNum(src[k]);
    }
    out.push({ code, name, note, prices });
  }
  return out;
}
