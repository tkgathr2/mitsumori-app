import "server-only";
import { Pool } from "pg";

// MoneyForward OAuth token を Railway Postgres に保存する層。
// lib/price-admin-db.ts と同じ作法（Pool使い回し・CREATE TABLE IF NOT EXISTS・
// 非破壊）を踏襲する。DROP系migrationは行わない。

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
      // client_codeごとに最新のトークン1件を保つ想定のUNIQUE制約。
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

function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export interface MFTokenRow {
  id: number;
  client_code: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * MF OAuth token を保存（同一 client_code は上書き）。
 * expiresIn は秒単位（token エンドポイントの expires_in をそのまま渡す）。
 */
export async function saveMFToken(
  clientCode: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<MFTokenRow> {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query<MFTokenRow>(
    `INSERT INTO mf_oauth_tokens (client_code, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, NOW())
     ON CONFLICT (client_code) DO UPDATE
       SET access_token = $2,
           refresh_token = $3,
           expires_at = NOW() + ($4 || ' seconds')::interval,
           updated_at = NOW()
     RETURNING id, client_code, access_token, refresh_token, expires_at, created_at, updated_at`,
    [clientCode, accessToken, refreshToken, expiresIn]
  );
  return res.rows[0];
}

/**
 * client_code に紐づく MF token を取得。無ければ null。
 */
export async function getMFToken(clientCode: string): Promise<MFTokenRow | null> {
  if (!dbConfigured()) return null;
  await ensureSchema();
  const res = await getPool().query<MFTokenRow>(
    `SELECT id, client_code, access_token, refresh_token, expires_at, created_at, updated_at
       FROM mf_oauth_tokens
      WHERE client_code = $1`,
    [clientCode]
  );
  return res.rows[0] || null;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * refresh_token を使って MF token エンドポイントから新しい access_token を取得する。
 * MF_CLIENT_SECRET が未設定の場合は実行時にエラーを投げる（実装は進めるが実行時エラーは許容）。
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
  const clientId = process.env.MF_CLIENT_ID;
  const clientSecret = process.env.MF_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "MF_CLIENT_ID / MF_CLIENT_SECRET が未設定です。社長からのClient Secret受領後、環境変数を設定してください。"
    );
  }

  const tokenUrl = "https://app.moneyforward.com/oauth/token";
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`MF token refresh failed: ${res.status} ${detail}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}
