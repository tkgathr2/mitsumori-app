import "server-only";
import { Pool } from "pg";
import { RATE_DEFS, type RateKey, type Company } from "./prices";

// 単価マスタDB（管理画面 /admin 用）。
//   ・price_companies … 会社マスタ（soft-delete。code の一意性は partial index）
//   ・price_rates     … 会社×12区分の単価
//   ・price_history   … 単価変更の履歴（旧値→新値）
// 既存 lib/price-cache-db.ts / lib/mf-tokens.ts の Pool 管理・ensureSchema
// キャッシュ方式を踏襲。マイグレーションは CREATE TABLE IF NOT EXISTS のみ（DROP禁止）。

const RATE_KEYS: RateKey[] = RATE_DEFS.map((d) => d.key);
const RATE_KEY_SET = new Set<string>(RATE_KEYS);

// ---- Pool（サーバーレスのコネクション枯渇を避けるためモジュールで1個） ----
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _pool;
}

let _schemaReady: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      const pool = getPool();
      await pool.query(
        `CREATE TABLE IF NOT EXISTS price_companies (
           id         serial PRIMARY KEY,
           code       text,
           name       text NOT NULL,
           note       text DEFAULT '',
           sort_order int DEFAULT 0,
           created_at timestamptz DEFAULT NOW(),
           updated_at timestamptz DEFAULT NOW(),
           deleted_at timestamptz NULL
         )`
      );
      // soft-delete のため一意性は partial index（生きている行のみ code 一意）。
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS price_companies_code_unique
           ON price_companies(code) WHERE deleted_at IS NULL`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS price_rates (
           id         serial PRIMARY KEY,
           company_id int REFERENCES price_companies(id),
           rate_key   text,
           price      int NOT NULL DEFAULT 0,
           updated_at timestamptz DEFAULT NOW(),
           UNIQUE(company_id, rate_key)
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS price_history (
           id           serial PRIMARY KEY,
           company_id   int,
           company_name text,
           rate_key     text,
           old_price    int,
           new_price    int,
           changed_by   text DEFAULT 'admin',
           changed_at   timestamptz DEFAULT NOW()
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS quotes (
           id           serial PRIMARY KEY,
           company_code text NOT NULL,
           name         text NOT NULL DEFAULT '',
           quote_data   jsonb NOT NULL,
           data_hash    text NOT NULL DEFAULT '',
           created_at   timestamptz DEFAULT NOW()
         )`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS quotes_company_created
           ON quotes(company_code, created_at DESC)`
      );
    })()
      .then(() => undefined)
      .catch((e) => {
        _schemaReady = null;
        throw e;
      });
  }
  return _schemaReady;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// ---- 型 ----
export interface AdminCompany {
  id: number;
  code: string;
  name: string;
  note: string;
  sortOrder: number;
  prices: Record<RateKey, number>;
}

export interface HistoryRow {
  id: number;
  companyId: number | null;
  companyName: string;
  rateKey: string;
  oldPrice: number | null;
  newPrice: number | null;
  changedBy: string;
  changedAt: string;
}

function emptyPrices(): Record<RateKey, number> {
  const p = {} as Record<RateKey, number>;
  for (const k of RATE_KEYS) p[k] = 0;
  return p;
}

// ---- 会社CRUD ----

// 生きている会社（deleted_at IS NULL）を単価つきで返す。
export async function listCompanies(): Promise<AdminCompany[]> {
  await ensureSchema();
  const pool = getPool();
  const cRes = await pool.query<{
    id: number;
    code: string | null;
    name: string;
    note: string | null;
    sort_order: number;
  }>(
    `SELECT id, code, name, note, sort_order
       FROM price_companies
      WHERE deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`
  );
  const companies: AdminCompany[] = cRes.rows.map((r) => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name,
    note: r.note ?? "",
    sortOrder: r.sort_order ?? 0,
    prices: emptyPrices(),
  }));
  if (companies.length === 0) return companies;

  const byId = new Map(companies.map((c) => [c.id, c]));
  const ids = companies.map((c) => c.id);
  const rRes = await pool.query<{
    company_id: number;
    rate_key: string;
    price: number;
  }>(
    `SELECT company_id, rate_key, price
       FROM price_rates
      WHERE company_id = ANY($1::int[])`,
    [ids]
  );
  for (const row of rRes.rows) {
    const c = byId.get(row.company_id);
    if (c && RATE_KEY_SET.has(row.rate_key)) {
      c.prices[row.rate_key as RateKey] = row.price;
    }
  }
  return companies;
}

export async function createCompany(input: {
  code?: string;
  name: string;
  note?: string;
  sortOrder?: number;
}): Promise<AdminCompany> {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query<{
    id: number;
    code: string | null;
    name: string;
    note: string | null;
    sort_order: number;
  }>(
    `INSERT INTO price_companies (code, name, note, sort_order)
       VALUES ($1, $2, $3, $4)
     RETURNING id, code, name, note, sort_order`,
    [input.code ?? "", input.name, input.note ?? "", input.sortOrder ?? 0]
  );
  const r = res.rows[0];
  // 12区分ぶんの単価行を0で初期化。
  await pool.query(
    `INSERT INTO price_rates (company_id, rate_key, price)
       SELECT $1, k, 0 FROM unnest($2::text[]) AS k
     ON CONFLICT (company_id, rate_key) DO NOTHING`,
    [r.id, RATE_KEYS]
  );
  return {
    id: r.id,
    code: r.code ?? "",
    name: r.name,
    note: r.note ?? "",
    sortOrder: r.sort_order ?? 0,
    prices: emptyPrices(),
  };
}

export async function updateCompany(
  id: number,
  input: { code?: string; name?: string; note?: string; sortOrder?: number }
): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (input.code !== undefined) {
    sets.push(`code = $${i++}`);
    vals.push(input.code);
  }
  if (input.name !== undefined) {
    sets.push(`name = $${i++}`);
    vals.push(input.name);
  }
  if (input.note !== undefined) {
    sets.push(`note = $${i++}`);
    vals.push(input.note);
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${i++}`);
    vals.push(input.sortOrder);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  await getPool().query(
    `UPDATE price_companies SET ${sets.join(", ")}
       WHERE id = $${i} AND deleted_at IS NULL`,
    vals
  );
}

export async function softDeleteCompany(id: number): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `UPDATE price_companies SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
}

// ---- 単価更新（更新のたび price_history に旧→新を記録） ----
export async function updateRate(
  companyId: number,
  rateKey: string,
  newPrice: number,
  changedBy = "admin"
): Promise<void> {
  if (!RATE_KEY_SET.has(rateKey)) {
    throw new Error(`unknown rate_key: ${rateKey}`);
  }
  await ensureSchema();
  const pool = getPool();
  const cRes = await pool.query<{ name: string }>(
    `SELECT name FROM price_companies WHERE id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  if (cRes.rows.length === 0) throw new Error(`company not found: ${companyId}`);
  const companyName = cRes.rows[0].name;

  const oldRes = await pool.query<{ price: number }>(
    `SELECT price FROM price_rates WHERE company_id = $1 AND rate_key = $2`,
    [companyId, rateKey]
  );
  const oldPrice = oldRes.rows.length ? oldRes.rows[0].price : null;

  await pool.query(
    `INSERT INTO price_rates (company_id, rate_key, price, updated_at)
       VALUES ($1, $2, $3, NOW())
     ON CONFLICT (company_id, rate_key)
       DO UPDATE SET price = $3, updated_at = NOW()`,
    [companyId, rateKey, newPrice]
  );

  if (oldPrice !== newPrice) {
    await pool.query(
      `INSERT INTO price_history
         (company_id, company_name, rate_key, old_price, new_price, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, companyName, rateKey, oldPrice, newPrice, changedBy]
    );
  }
}

// ---- 履歴（最新100件） ----
export async function listHistory(limit = 100): Promise<HistoryRow[]> {
  await ensureSchema();
  const res = await getPool().query<{
    id: number;
    company_id: number | null;
    company_name: string | null;
    rate_key: string;
    old_price: number | null;
    new_price: number | null;
    changed_by: string | null;
    changed_at: Date;
  }>(
    `SELECT id, company_id, company_name, rate_key, old_price, new_price,
            changed_by, changed_at
       FROM price_history
      ORDER BY changed_at DESC, id DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name ?? "",
    rateKey: r.rate_key,
    oldPrice: r.old_price,
    newPrice: r.new_price,
    changedBy: r.changed_by ?? "admin",
    changedAt: new Date(r.changed_at).toISOString(),
  }));
}

// ---- 初期データ移行（seed）用の upsert ----
// 同じ code の生きている会社があれば会社情報＋単価を上書き、無ければ新規作成。
export async function upsertCompanyWithRates(input: {
  code: string;
  name: string;
  note?: string;
  prices: Record<string, number>;
}): Promise<{ id: number; created: boolean }> {
  await ensureSchema();
  const pool = getPool();
  const code = (input.code ?? "").trim();

  let companyId: number;
  let created: boolean;
  const found = code
    ? await pool.query<{ id: number }>(
        `SELECT id FROM price_companies WHERE code = $1 AND deleted_at IS NULL`,
        [code]
      )
    : { rows: [] as { id: number }[] };

  if (found.rows.length > 0) {
    companyId = found.rows[0].id;
    created = false;
    await pool.query(
      `UPDATE price_companies
          SET name = $1, note = $2, updated_at = NOW()
        WHERE id = $3`,
      [input.name, input.note ?? "", companyId]
    );
  } else {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO price_companies (code, name, note)
         VALUES ($1, $2, $3) RETURNING id`,
      [code, input.name, input.note ?? ""]
    );
    companyId = ins.rows[0].id;
    created = true;
  }

  for (const k of RATE_KEYS) {
    const price = Number.isFinite(input.prices[k]) ? input.prices[k] : 0;
    await pool.query(
      `INSERT INTO price_rates (company_id, rate_key, price, updated_at)
         VALUES ($1, $2, $3, NOW())
       ON CONFLICT (company_id, rate_key)
         DO UPDATE SET price = $3, updated_at = NOW()`,
      [companyId, k, price]
    );
  }
  return { id: companyId, created };
}

// ---- /api/prices 用：DBの会社を Company[] 形に変換 ----
export async function loadCompaniesForPriceData(): Promise<Company[]> {
  const rows = await listCompanies();
  return rows.map((c) => {
    const prices = { ...emptyPrices(), ...c.prices };
    return {
      code: c.code,
      name: c.name,
      prices,
      hasPrice: Object.values(prices).some((v) => v > 0),
    };
  });
}

// ---- 見積履歴（会社ごと・直近5「種類」= 同一明細はまとめて1種類） ----
export interface QuoteRow {
  id: number;
  companyCode: string;
  name: string;
  quoteData: unknown;
  createdAt: string;
}

// 明細内容から安定ハッシュを作る（同一構成の重複判定用）
function hashQuoteData(data: unknown): string {
  const s = JSON.stringify(data);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + "_" + s.length;
}

export async function saveQuote(
  companyCode: string,
  name: string,
  quoteData: unknown
): Promise<QuoteRow> {
  await ensureSchema();
  const res = await getPool().query<{
    id: number;
    company_code: string;
    name: string;
    quote_data: unknown;
    created_at: string;
  }>(
    `INSERT INTO quotes (company_code, name, quote_data, data_hash)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, company_code, name, quote_data, created_at`,
    [companyCode, name, JSON.stringify(quoteData), hashQuoteData(quoteData)]
  );
  const r = res.rows[0];
  return {
    id: r.id,
    companyCode: r.company_code,
    name: r.name,
    quoteData: r.quote_data,
    createdAt: r.created_at,
  };
}

// 直近の見積を「種類」単位で最大 limit 件（同じ data_hash は最新1件に集約）
export async function listQuotesByCompany(companyCode: string, limit = 5): Promise<QuoteRow[]> {
  if (!isDbConfigured()) return [];
  await ensureSchema();
  const res = await getPool().query<{
    id: number;
    company_code: string;
    name: string;
    quote_data: unknown;
    created_at: string;
  }>(
    `SELECT DISTINCT ON (data_hash)
            id, company_code, name, quote_data, created_at
       FROM quotes
      WHERE company_code = $1
      ORDER BY data_hash, created_at DESC`,
    [companyCode]
  );
  return res.rows
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      companyCode: r.company_code,
      name: r.name,
      quoteData: r.quote_data,
      createdAt: r.created_at,
    }));
}

// DBに「生きている会社」が1件でもあるか（getPriceData のDB優先判定用）。
export async function hasActiveCompanies(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    await ensureSchema();
    const res = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM price_companies WHERE deleted_at IS NULL`
    );
    return Number(res.rows[0]?.n ?? "0") > 0;
  } catch {
    return false;
  }
}
