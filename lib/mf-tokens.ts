import { Pool } from "pg";

// MF OAuth トークンの永続化層（Railway Postgres）。
// - DATABASE_URL があれば mf_oauth_tokens テーブルに client_code='default' で1件保存
// - DBが無い/未保存の場合は MF_REFRESH_TOKEN 環境変数をブートストラップ値として返す
// lib/price-admin-db.ts と同じ作法（Pool使い回し・CREATE TABLE IF NOT EXISTS・非破壊）。
// DROP系migrationは行わない。

export interface MfTokenRecord {
  access_token: string;
  refresh_token: string;
  access_expires_at: number; // epoch ms（0=期限切れ扱い→必ずrefreshが走る）
  updated_at: number; // epoch ms
}

const CLIENT_CODE = "default";

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
        `CREATE TABLE IF NOT EXISTS mf_oauth_tokens (
           id            serial PRIMARY KEY,
           client_code   text NOT NULL,
           access_token  text NOT NULL,
           refresh_token text NOT NULL,
           expires_at    timestamptz NOT NULL,
           created_at    timestamptz DEFAULT NOW(),
           updated_at    timestamptz DEFAULT NOW()
         )`
      );
      // client_codeごとに最新のトークン1件を保つUNIQUE制約。
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS mf_oauth_tokens_client_code_unique
           ON mf_oauth_tokens(client_code)`
      );
    })().catch((e) => {
      _schemaReady = null;
      throw e;
    });
  }
  return _schemaReady;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// 後方互換: 「永続化ストレージが構成済みか」を返す（旧名のまま参照している箇所用）
export function isKvConfigured(): boolean {
  return isDbConfigured();
}

/**
 * 保存済みトークンを読む。DB→envブートストラップの順で解決し、どちらも無ければ null。
 */
export async function loadTokens(): Promise<MfTokenRecord | null> {
  if (isDbConfigured()) {
    await ensureSchema();
    const res = await getPool().query(
      `SELECT access_token, refresh_token, expires_at, updated_at
         FROM mf_oauth_tokens
        WHERE client_code = $1`,
      [CLIENT_CODE]
    );
    const row = res.rows[0];
    if (row) {
      return {
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        access_expires_at: new Date(row.expires_at).getTime(),
        updated_at: new Date(row.updated_at).getTime(),
      };
    }
  }
  // DB未構成/未保存でも、MF_REFRESH_TOKEN があればそれを種にできる
  const seed = process.env.MF_REFRESH_TOKEN;
  if (seed) {
    return {
      access_token: "",
      refresh_token: seed,
      access_expires_at: 0,
      updated_at: 0,
    };
  }
  return null;
}

/**
 * トークンを保存（client_code='default' を上書き）。
 * DBが無い環境では何もしない（呼び出し元が refresh_token を運用者へ提示する）。
 */
export async function saveTokens(rec: MfTokenRecord): Promise<void> {
  if (!isDbConfigured()) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO mf_oauth_tokens (client_code, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), NOW())
     ON CONFLICT (client_code) DO UPDATE
       SET access_token = $2,
           refresh_token = $3,
           expires_at = to_timestamp($4 / 1000.0),
           updated_at = NOW()`,
    [CLIENT_CODE, rec.access_token, rec.refresh_token, rec.access_expires_at]
  );
}
