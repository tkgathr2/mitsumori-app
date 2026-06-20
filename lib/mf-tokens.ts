// MFクラウド請求書 OAuth トークンの保存・読み出し。
//
// 保存先 = 自前 Railway Postgres（DATABASE_URL）。
//   ・テーブル mf_oauth_tokens に「1事業者=日本交通誘導の共有トークン」を1行だけ upsert する。
//   ・MF の refresh_token は「使うと新しい値に置き換わる（ローテーション）」ため、
//     refresh 成功のたびに新トークンで上書きする。これが永続化の肝。
//
// ブートストラップ（初回のみ）：DBが空のとき、env MF_REFRESH_TOKEN があれば
//   そこから最小レコードを組んで返す。以後は DB が正本になり、env は無視される。
//
// Vercel KV / Upstash は使わない（マーケットプレイス規約同意を避けるため）。

import { Pool } from "pg";

export interface MfTokenRecord {
  access_token: string;
  refresh_token: string;
  // access_token の失効時刻（epoch ミリ秒）
  access_expires_at: number;
  // 最後に更新した時刻（epoch ミリ秒）
  updated_at: number;
}

// 1事業者ぶんの固定行ID（日本交通誘導の共有トークン）。
const ROW_ID = "nihonkotsuyudo";

function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// Pool はモジュールスコープで1個だけ（サーバーレスのコネクション枯渇を避ける）。
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Railway の Postgres は TLS。証明書チェーンは検証しない（マネージド前提）。
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _pool;
}

let _schemaReady: Promise<void> | null = null;
// テーブルを必要時に1回だけ作る（マイグレーションは単純・範囲型は使わない）。
async function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS mf_oauth_tokens (
           id            text PRIMARY KEY,
           access_token  text,
           refresh_token text,
           expires_at    timestamptz,
           updated_at    timestamptz
         )`
      )
      .then(() => undefined)
      .catch((e) => {
        // 失敗したら次回また試せるようにリセット
        _schemaReady = null;
        throw e;
      });
  }
  return _schemaReady;
}

interface Row {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  updated_at: Date | null;
}

function rowToRecord(row: Row): MfTokenRecord | null {
  if (!row.refresh_token) return null;
  return {
    access_token: row.access_token || "",
    refresh_token: row.refresh_token,
    access_expires_at: row.expires_at ? row.expires_at.getTime() : 0,
    updated_at: row.updated_at ? row.updated_at.getTime() : 0,
  };
}

export async function loadTokens(): Promise<MfTokenRecord | null> {
  if (dbConfigured()) {
    try {
      await ensureSchema();
      const res = await getPool().query<Row>(
        `SELECT access_token, refresh_token, expires_at, updated_at
           FROM mf_oauth_tokens WHERE id = $1`,
        [ROW_ID]
      );
      if (res.rows.length > 0) {
        const rec = rowToRecord(res.rows[0]);
        if (rec) return rec;
      }
    } catch (e) {
      // DB読み出し失敗時は env フォールバックへ
      console.error("[mf-tokens] DB load failed:", e);
    }
  }
  // ブートストラップ：env の refresh_token から最小レコードを組む（初回のみ）
  const envRefresh = process.env.MF_REFRESH_TOKEN;
  if (envRefresh) {
    return {
      access_token: "",
      refresh_token: envRefresh,
      access_expires_at: 0, // 期限切れ扱い → 必ずrefreshさせる
      updated_at: 0,
    };
  }
  return null;
}

export async function saveTokens(rec: MfTokenRecord): Promise<void> {
  if (!dbConfigured()) {
    // DB未設定では永続化できない（env は実行時に書き換えられない）。
    console.error("[mf-tokens] DATABASE_URL 未設定のため保存できません。");
    return;
  }
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO mf_oauth_tokens (id, access_token, refresh_token, expires_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         access_token  = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at    = EXCLUDED.expires_at,
         updated_at    = EXCLUDED.updated_at`,
      [
        ROW_ID,
        rec.access_token,
        rec.refresh_token,
        rec.access_expires_at ? new Date(rec.access_expires_at) : null,
        rec.updated_at ? new Date(rec.updated_at) : new Date(),
      ]
    );
  } catch (e) {
    console.error("[mf-tokens] DB save failed:", e);
  }
}

// 永続化ストレージ（DB）が構成済みか。
export function isDbConfigured(): boolean {
  return dbConfigured();
}

// 後方互換：呼び出し側（mf-health / mf-callback）が参照している名前。
// 「永続化ストレージが構成済みか」を返す（旧KVから意味を引き継ぐ）。
export function isKvConfigured(): boolean {
  return dbConfigured();
}
