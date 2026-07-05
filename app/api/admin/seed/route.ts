import { type NextRequest, NextResponse } from "next/server";
import {
  SHEET_ID as DEFAULT_SHEET_ID,
  readSaCreds,
} from "@/lib/prices";
import { parseSeedCsv, parseSeedJson, type SeedCompany } from "@/lib/seed-parse";
import { upsertCompanyWithRates } from "@/lib/price-admin-db";
import { ADMIN_COOKIE, verifySessionToken, timingSafeEqualStr } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 新シート（西村さんマスタ）。export CSV → SA API → 直接投入 の順で取り込む。
const SEED_SHEET_ID = process.env.SEED_SHEET_ID || "1_yO9wq5e-hng5LNdOX7tadDnFtKw-CfE";
const SEED_GID = process.env.SEED_SHEET_GID || "330210674";
const SEED_RANGE = process.env.SEED_SHEET_RANGE || "A1:Z200";

interface SeedBody {
  mode?: "auto" | "csv" | "json";
  csv?: string;
  companies?: unknown[];
}

// 認証：セッションcookie もしくは x-api-key（ADMIN_PASSWORD / PRICE_SYNC_SECRET）。
async function authorized(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifySessionToken(token)) return true;
  const key = req.headers.get("x-api-key");
  if (!key) return false;
  const candidates = [
    process.env.ADMIN_PASSWORD,
    process.env.PRICE_SYNC_SECRET,
  ].filter((v): v is string => Boolean(v && v.trim()));
  // タイミング攻撃対策：平文の一致（includes）ではなく定数時間比較で照合する。
  return candidates.some((c) => timingSafeEqualStr(key, c));
}

// ① 公開export CSV（新シートが公開共有されていれば成功）。
async function tryExportCsv(): Promise<SeedCompany[] | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SEED_SHEET_ID}/export?format=csv&gid=${SEED_GID}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": "mitsumori-app/1.0" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (ct.includes("text/html") || text.trimStart().startsWith("<")) return null;
    const parsed = parseSeedCsv(text);
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// ② サービスアカウント Sheets API（lib/prices-server.ts と同じ鍵経路）。
async function tryServiceAccount(): Promise<SeedCompany[] | null> {
  const creds = readSaCreds();
  if (!creds) return null;
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SEED_SHEET_ID,
      range: SEED_RANGE,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = (res.data.values || []).map((r) =>
      (r as unknown[]).map((c) => (c == null ? "" : String(c)))
    );
    // rows → CSVテキスト風に parseSeedCsv へ渡す（クォート不要な素の値）。
    const text = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const parsed = parseSeedCsv(text);
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SeedBody = {};
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as SeedBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = body.mode ?? "auto";
  let companies: SeedCompany[] | null = null;
  let sourceUsed = "";

  // 直接投入モード（確実に動く経路）。
  if (mode === "json" && Array.isArray(body.companies)) {
    companies = parseSeedJson(body.companies);
    sourceUsed = "json";
  } else if (mode === "csv" && typeof body.csv === "string") {
    companies = parseSeedCsv(body.csv);
    sourceUsed = "csv";
  } else if (mode === "auto") {
    // 明示CSV/JSONが渡っていれば優先、なければシート取得を試す。
    if (typeof body.csv === "string" && body.csv.trim()) {
      companies = parseSeedCsv(body.csv);
      sourceUsed = "csv";
    } else if (Array.isArray(body.companies) && body.companies.length) {
      companies = parseSeedJson(body.companies);
      sourceUsed = "json";
    } else {
      companies = await tryExportCsv();
      if (companies) sourceUsed = "export-csv";
      if (!companies) {
        companies = await tryServiceAccount();
        if (companies) sourceUsed = "service-account";
      }
    }
  }

  if (!companies || companies.length === 0) {
    return NextResponse.json(
      {
        error:
          "取り込むデータがありません。新シートが公開/SA共有されていないため、" +
          "直接投入モードで渡してください（mode:'json' + companies[] または mode:'csv' + csv）。",
        sheet: {
          id: SEED_SHEET_ID,
          gid: SEED_GID,
          defaultSheetId: DEFAULT_SHEET_ID,
        },
        hint:
          "列マッピング=会社コード/会社名/備考＋12単価（一般6+有資格6）。" +
          "ヘッダ行に「会社名」「会社コード」「備考」があれば自動検出、無ければ固定列順(No,コード,会社名,12単価)。",
      },
      { status: 422 }
    );
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const c of companies) {
    try {
      const r = await upsertCompanyWithRates({
        code: c.code,
        name: c.name,
        note: c.note,
        prices: c.prices,
      });
      if (r.created) created++;
      else updated++;
    } catch (e) {
      errors.push(`${c.name}: ${String(e)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    source: sourceUsed,
    total: companies.length,
    created,
    updated,
    errors,
  });
}
