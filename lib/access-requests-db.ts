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
    })();
  }
  await _schemaReady;
}

const DEDUP_WINDOW_MS = 1000 * 60 * 60; // 同じメール・同じ画面への申請は1時間に1回だけ通知（連打対策）

// 申請を記録し、直近1時間以内に同じ申請が無ければ true（＝新規＝通知すべき）を返す。
export async function recordAccessRequest(email: string, flow: AccessFlow): Promise<boolean> {
  await ensureSchema();
  const pool = getPool();
  const recent = await pool.query(
    `SELECT 1 FROM access_requests
       WHERE email = $1 AND flow = $2 AND created_at > NOW() - ($3 || ' milliseconds')::interval
       LIMIT 1`,
    [email, flow, DEDUP_WINDOW_MS]
  );
  await pool.query(`INSERT INTO access_requests (email, flow) VALUES ($1, $2)`, [email, flow]);
  return recent.rowCount === 0;
}

const FLOW_LABEL: Record<AccessFlow, string> = {
  general: "見積もり画面",
  admin: "管理画面",
};

// 高木さんのSlack user ID（メンション用）。
const OWNER_SLACK_MENTION = "<@UPFSHKUAW>";

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
    });
  } catch (e) {
    console.error("access request slack notify failed:", e);
  }
}
