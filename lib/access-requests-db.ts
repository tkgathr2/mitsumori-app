import "server-only";
import { Pool } from "pg";

// ログイン許可リストに載っていないメールがログインを試みたときの「申請」記録。
// 既存 lib/price-admin-db.ts と同じ Pool 管理・ensureSchema キャッシュ方式を踏襲。

export type AccessFlow = "general" | "admin";

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
        `CREATE TABLE IF NOT EXISTS access_requests (
           id         serial PRIMARY KEY,
           email      text NOT NULL,
           flow       text NOT NULL,
           created_at timestamptz DEFAULT NOW()
         )`
      );
      // 重複排除の SELECT が Seq Scan にならないように。この関数は許可リスト外の
      // 任意のGoogleアカウントから到達できるため、行が増えても劣化しないこと。
      await pool.query(
        `CREATE INDEX IF NOT EXISTS access_requests_email_flow_created
           ON access_requests(email, flow, created_at DESC)`
      );
    })()
      .then(() => undefined)
      // 失敗したPromiseを掴んだままにすると二度と再試行されず申請機能が死ぬ。
      // 次回呼び出しでやり直せるようにキャッシュを捨てる（price-admin-db.ts と同じ）。
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

const DEDUP_WINDOW_MS = 1000 * 60 * 60; // 同じメール・同じ画面への申請は1時間に1回だけ通知（連打対策）

// 申請を記録し、新規（＝通知すべき）なら true を返す。
//
// 1行 = 1通知。「通知したときだけ」行を入れるので、ウィンドウの起点は常に
// 「最後に通知した時刻」になる。無条件INSERTにすると起点が毎回前進してしまい、
// 60分未満の間隔で押し続ける人には永久に初回1件しか通知されない（連打する人ほど救われない）。
//
// 判定とINSERTを1文にまとめてあるので、同時リクエストで通知が二重に飛ぶこともない。
export async function recordAccessRequest(email: string, flow: AccessFlow): Promise<boolean> {
  // DB未設定・DB不通のときは「通知する」側に倒す。
  // 申請を取りこぼすより、通知が重複する方が遥かにマシ。
  if (!isDbConfigured()) return true;
  try {
    await ensureSchema();
    const res = await getPool().query(
      `INSERT INTO access_requests (email, flow)
       SELECT $1::text, $2::text
        WHERE NOT EXISTS (
                SELECT 1 FROM access_requests
                 WHERE email = $1 AND flow = $2
                   AND created_at > NOW() - ($3 || ' milliseconds')::interval
              )
       RETURNING id`,
      [email, flow, DEDUP_WINDOW_MS]
    );
    return (res.rowCount ?? 0) > 0;
  } catch (e) {
    console.error("access request record failed:", e);
    return true;
  }
}

const FLOW_LABEL: Record<AccessFlow, string> = {
  general: "見積もり画面",
  admin: "管理画面",
};

// 高木さんのSlack user ID（メンション用）。
const OWNER_SLACK_MENTION = "<@UPFSHKUAW>";

// persona-relay が無応答だとOAuthコールバックごとハングして502/504になるため、
// 例外だけでなく「返ってこない」も打ち切る。
const NOTIFY_TIMEOUT_MS = 5000;

// persona-slack-relay（真田Bot名義）経由で申請を通知。失敗しても申請自体は記録済みなので握りつぶす。
export async function notifyAccessRequest(email: string, flow: AccessFlow): Promise<void> {
  const url = process.env.PERSONA_RELAY_URL;
  const secret = process.env.PERSONA_RELAY_SECRET;
  const channel = process.env.ACCESS_REQUEST_SLACK_CHANNEL;
  if (!url || !secret || !channel) return;

  const envVar = flow === "admin" ? "ADMIN_GOOGLE_EMAILS_JSON" : "ALLOWED_USER_EMAILS";
  const text =
    `${OWNER_SLACK_MENTION} みつもりくんへのアクセス申請がありました\n` +
    `・メール: ${email}\n` +
    `・対象: ${FLOW_LABEL[flow]}\n` +
    `許可する場合はRailwayの環境変数 ${envVar} にこのメールを追加してください。`;

  try {
    await fetch(`${url}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": secret },
      body: JSON.stringify({ persona: "sanada", channel, text }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch (e) {
    console.error("access request slack notify failed:", e);
  }
}
